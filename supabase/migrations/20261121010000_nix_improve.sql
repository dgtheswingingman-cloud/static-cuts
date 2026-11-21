-- NIX improvements (21 Nov 2026)
--
-- 1. Faster: up to 2 batches ready per job at all times, and the next one is
--    queued the moment the PC hands an answer back (no waiting for the minute
--    tick). Review notes skip items already out with the PC.
-- 2. Better suggestions: NIX says how sure it is (high/medium/low); handles and
--    links are never taken as producers/features; track numbers ("13 - ") are
--    stripped from cleaned titles. Open suggestions are tidied the same way.
-- 3. Learning from every list: your recent accepts/dismissals of NIX
--    suggestions, and duplicate / clean-up decisions that went against its
--    note, go into its next prompts as worked examples. /nix shows how often
--    it agreed with you per job.
-- 4. Order and progress: artists people care about first (launch artists,
--    then follows, then Deezer fans); /nix shows each job's progress, speed
--    and finish estimate; Alerts say if the NIX PC has been offline over an hour.

-- Take NIX's tables up front, in one order, so this can't deadlock with jobs running.
lock table public.nix_ai_jobs, public.nix_work, public.nix_notes, public.nix_suggestions in access exclusive mode;

-- ---------------------------------------------------------------- priority
create or replace function public.sc_nix_artist_priority(p_artist text)
returns bigint language sql stable security definer set search_path to 'public' as $$
  select (case when exists (select 1 from launch_artists l where l.artist_id = p_artist) then 1000000000000 else 0 end)
       + (select count(*) from follows f where f.artist_id = p_artist) * 1000000000
       + coalesce((select least(a.deezer_fans, 999999999) from artists a where a.id = p_artist), 0);
$$;

alter table public.nix_work add column if not exists priority bigint not null default 0;
create index if not exists nix_work_priority_idx on public.nix_work (kind, priority desc, item_key) where pending_at is null;

with p as (
  select a.id, sc_nix_artist_priority(a.id) pr from artists a
  where a.id in (select distinct t.artist_id from tracks t join nix_work w on w.item_key = t.id)
     or a.id in (select distinct group_key from nix_work where group_key is not null)
)
update nix_work w set priority = p.pr
from tracks t, p
where w.kind in ('notes', 'titles', 'eras') and t.id = w.item_key and p.id = t.artist_id and p.pr > 0;

update nix_work w set priority = sc_nix_artist_priority(t.artist_id)
from version_suggestions vs join tracks t on t.id = vs.track_id
where w.kind = 'audit' and vs.id::text = w.item_key
  and (exists (select 1 from launch_artists l where l.artist_id = t.artist_id) or exists (select 1 from follows f where f.artist_id = t.artist_id));

-- new work gets its priority as it's added
create or replace function public.sc_nix_work_priority()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.priority = 0 then
    new.priority := coalesce(sc_nix_artist_priority(case
      when new.kind = 'audit' then (select t.artist_id from version_suggestions vs join tracks t on t.id = vs.track_id where vs.id::text = new.item_key)
      when new.group_key is not null then new.group_key
      else (select artist_id from tracks where id = new.item_key) end), 0);
  end if;
  return new;
end $$;
drop trigger if exists nix_work_priority on public.nix_work;
create trigger nix_work_priority before insert on public.nix_work for each row execute function public.sc_nix_work_priority();

-- batches: most important first
do $$
declare d text := pg_get_functiondef('public.sc_nix_suggest_batch'::regproc);
begin
  d := replace(d, 'select group_key into grp from nix_work where kind = ''eras'' and pending_at is null order by group_key limit 1;',
                  'select group_key into grp from nix_work where kind = ''eras'' and pending_at is null order by priority desc, group_key limit 1;');
  d := replace(d, 'select item_key from nix_work where kind = p_kind and pending_at is null order by item_key',
                  'select item_key from nix_work where kind = p_kind and pending_at is null order by priority desc, item_key');
  if position('order by priority desc, group_key' in d) = 0 or position('order by priority desc, item_key' in d) = 0 then raise exception 'priority patch missed'; end if;
  execute d;
end $$;

-- ------------------------------------------------------- better suggestions
alter table public.nix_suggestions add column if not exists confidence text;

create or replace function public.sc_nix_clean_name(v text)
returns text language sql immutable as $$
  -- null for things that aren't a person's or act's name (handles, links, "N/A")
  select case when v is null or v ~* '(@|https?:|www\.|\.com\b)' or lower(trim(v)) in ('null', 'none', 'unknown', 'n/a', '-', '?') or length(trim(v)) > 200
              then null else nullif(trim(regexp_replace(v, '^\s*(prod(uced)?\.?\s*(by)?|feat\.?|ft\.?)\s*', '', 'i')), '') end;
$$;

-- tidy what's already waiting
update nix_suggestions set suggested = regexp_replace(suggested, '^\d{1,3}\s*[-–.)]\s+', '')
where state = 'open' and field = 'title' and suggested ~ '^\d{1,3}\s*[-–.)]\s+';
update nix_suggestions set state = 'stale', decided_at = now()
where state = 'open' and field in ('producers', 'featured_artists', 'aliases') and sc_nix_clean_name(suggested) is null;
update nix_suggestions s set state = 'stale', decided_at = now()
from tracks t where s.state = 'open' and s.field = 'title' and t.id = s.track_id and s.suggested = t.title;

-- the save step: confidence + the checks above
do $$
declare d text := pg_get_functiondef('public.sc_nix_suggest_save'::regproc);
begin
  -- names go through sc_nix_clean_name
  d := replace(d, 'val := nullif(trim(r ->> ''producers''), '''');', 'val := sc_nix_clean_name(r ->> ''producers'');');
  d := replace(d, 'val := nullif(trim(r ->> ''featuring''), '''');', 'val := sc_nix_clean_name(r ->> ''featuring'');');
  d := replace(d, 'val := nullif(trim(r ->> ''other_names''), '''');', 'val := sc_nix_clean_name(r ->> ''other_names'');');
  -- cleaned titles lose a leading track number
  d := replace(d, 'val := nullif(trim(r ->> ''title''), '''');', 'val := nullif(trim(regexp_replace(coalesce(r ->> ''title'', ''''), ''^\d{1,3}\s*[-–.)]\s+'', '''')), '''');');
  -- every suggestion carries how sure NIX was
  d := replace(d, 'insert into nix_suggestions (kind, track_id, field, current_value, suggested, note, model)',
                  'insert into nix_suggestions (kind, track_id, field, current_value, suggested, note, model, confidence)');
  d := regexp_replace(d, ', p_model\)( on conflict| *\n)', ', p_model, case when lower(r ->> ''sure'') in (''high'', ''medium'', ''low'') then lower(r ->> ''sure'') end)\1', 'g');
  if position('sc_nix_clean_name(r ->> ''producers'')' in d) = 0 or position('confidence)' in d) = 0 then raise exception 'save patch missed'; end if;
  execute d;
end $$;

-- ------------------------------------------------------------- lessons
alter table public.nix_notes add column if not exists line text;

-- What a person decided about a review note's item, from the list itself.
create or replace function public.sc_nix_review_outcome(p_kind text, p_key text)
returns text language sql stable security definer set search_path to 'public' as $$
  select case p_kind
    when 'duplicates' then case
      when exists (select 1 from duplicate_dismissals d where d.group_id = p_key) then 'different'
      when not exists (select 1 from duplicate_candidates c where c.group_id = p_key) then 'same' end
    when 'cleanup' then case
      when exists (select 1 from cleanup_kept k where k.track_id = p_key) then 'real_song'
      when not exists (select 1 from tracks t where t.id = p_key) then 'removed' end
  end;
$$;

-- Worked examples for the next prompt: recent decisions that went against
-- (or were left "unsure" by) NIX, newest first.
create or replace function public.sc_nix_lessons_text(p_kind text, p_n int default 8)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare v text;
begin
  if p_kind in ('notes', 'eras', 'audit', 'titles') then
    select string_agg(format('- "%s" by %s | %s: %s -> the owner %s', t.title, coalesce(a.name, '?'), s.field,
             case when s.field = 'parent' then 'unlink from "' || coalesce(s.current_value, '?') || '"' else s.suggested end,
             case s.state when 'accepted' then 'ACCEPTED this' else 'REJECTED this' end), E'\n')
    into v from (
      select * from nix_suggestions where kind = p_kind and state in ('accepted', 'rejected') and decided_by is not null
      order by (state = 'rejected') desc, decided_at desc limit p_n) s
    join tracks t on t.id = s.track_id left join artists a on a.id = t.artist_id;
  elsif p_kind in ('duplicates', 'cleanup') then
    select string_agg(format('- %s -> the owner decided: %s', x.line, x.outcome), E'\n') into v from (
      select n.line, sc_nix_review_outcome(p_kind, n.item_key) outcome, n.verdict from nix_notes n
      where n.kind = p_kind and n.line is not null and n.created_at > now() - interval '60 days'
      order by n.created_at desc limit 400) x
    where x.outcome is not null
      and not (x.outcome = x.verdict or (x.outcome = 'removed' and x.verdict in ('not_song', 'placeholder')))
    limit p_n;
  end if;
  if v is null then return ''; end if;
  return E'\n\nRecent decisions by the archive''s owner on cases like these (follow the same judgement):\n' || v;
end $$;

-- ------------------------------------------------- the two engines, faster
-- Review notes: skip items already out with the PC.
do $$
declare d text := pg_get_functiondef('public.sc_nix_review_items(text, int)'::regprocedure);
begin
  d := replace(d, 'and not exists (select 1 from nix_notes n where n.kind = ''duplicates'' and n.item_key = d.group_id)',
    'and not exists (select 1 from nix_notes n where n.kind = ''duplicates'' and n.item_key = d.group_id)
        and not exists (select 1 from nix_ai_jobs j where j.kind = ''review:duplicates'' and j.status in (''queued'', ''running'') and j.payload -> ''keys'' ? d.group_id)');
  d := replace(d, 'and not exists (select 1 from nix_notes n where n.kind = ''cleanup'' and n.item_key = t.id)',
    'and not exists (select 1 from nix_notes n where n.kind = ''cleanup'' and n.item_key = t.id)
        and not exists (select 1 from nix_ai_jobs j where j.kind = ''review:cleanup'' and j.status in (''queued'', ''running'') and j.payload -> ''keys'' ? t.id)');
  d := replace(d, 'and not exists (select 1 from nix_notes n where n.kind = ''mixups'' and n.item_key = f.id::text)',
    'and not exists (select 1 from nix_notes n where n.kind = ''mixups'' and n.item_key = f.id::text)
        and not exists (select 1 from nix_ai_jobs j where j.kind = ''review:mixups'' and j.status in (''queued'', ''running'') and j.payload -> ''keys'' ? f.id::text)');
  d := replace(d, 'and not exists (select 1 from nix_notes n where n.kind = ''deezer'' and n.item_key = a.id)',
    'and not exists (select 1 from nix_notes n where n.kind = ''deezer'' and n.item_key = a.id)
        and not exists (select 1 from nix_ai_jobs j where j.kind = ''review:deezer'' and j.status in (''queued'', ''running'') and j.payload -> ''keys'' ? a.id)');
  if (length(d) - length(replace(d, 'j.payload -> ''keys'' ?', ''))) / length('j.payload -> ''keys'' ?') <> 4 then raise exception 'items patch missed'; end if;
  execute d;
end $$;

create or replace function public.sc_nix_review()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare j record; ans jsonb; r jsonb; k text; idx int; saved int := 0; queued int := 0; items jsonb; size int; v_prompt text;
begin
  perform pg_advisory_xact_lock(hashtext('sc_nix_review'));
  for j in
    update nix_ai_jobs set status = 'collected'
    where id in (select id from nix_ai_jobs where kind like 'review:%' and status in ('done', 'failed') order by id limit 20 for update skip locked)
    returning kind, payload, output, error, model
  loop
    continue when j.error is not null or j.output is null;
    begin ans := substring(j.output from '\{.*\}')::jsonb; exception when others then continue; end;
    for r in select value from jsonb_array_elements(coalesce(ans -> 'r', '[]')) loop
      begin idx := (r ->> 'n')::int; exception when others then idx := null; end;
      continue when idx is null;
      k := j.payload -> 'keys' ->> (idx - 1);
      continue when k is null;
      insert into nix_notes (kind, item_key, verdict, note, model, line)
      values (substring(j.kind from 8), k, left(lower(r ->> 'v'), 20), left(r ->> 'why', 200), j.model, left(j.payload -> 'lines' ->> (idx - 1), 500))
      on conflict (kind, item_key) do update set verdict = excluded.verdict, note = excluded.note, model = excluded.model, line = excluded.line, created_at = now();
      saved := saved + 1;
    end loop;
  end loop;

  if sc_nix_ai_online() then
    foreach k in array array['duplicates', 'cleanup', 'mixups', 'deezer'] loop
      continue when (select count(*) from nix_ai_jobs x where x.kind = 'review:' || k and x.status in ('queued', 'running')) >= 2;
      size := case k when 'duplicates' then 20 when 'cleanup' then 30 when 'mixups' then 8 else 6 end;
      items := sc_nix_review_items(k, size);
      continue when jsonb_array_length(items) = 0;
      v_prompt := sc_nix_review_prompt(k, items);
      v_prompt := replace(v_prompt, E'\n\nReply with JSON only', sc_nix_lessons_text(k, 8) || E'\n\nReply with JSON only');
      insert into nix_ai_jobs (kind, prompt, payload, json_reply)
      values ('review:' || k, v_prompt,
              jsonb_build_object('keys', (select jsonb_agg(x -> 'key') from jsonb_array_elements(items) x),
                                 'lines', (select jsonb_agg(x -> 'line') from jsonb_array_elements(items) x)), false);
      queued := queued + 1;
    end loop;
  end if;
  return jsonb_build_object('saved', saved, 'queued', queued);
end $$;

-- Suggestions: 2 ready per job, lessons in the prompt, ask how sure.
do $$
declare d text := pg_get_functiondef('public.sc_nix_suggest'::regproc);
begin
  d := replace(d, 'continue when exists (select 1 from nix_ai_jobs x where x.kind = ''suggest:'' || v_kind and x.status in (''queued'', ''running''));',
                  'continue when (select count(*) from nix_ai_jobs x where x.kind = ''suggest:'' || v_kind and x.status in (''queued'', ''running'')) >= 2;');
  d := replace(d, 'values (''suggest:'' || v_kind, b ->> ''prompt'',',
                  'values (''suggest:'' || v_kind, replace(b ->> ''prompt'', E''\n\nReply with JSON only'', sc_nix_lessons_text(v_kind, 8) || E''\n\nReply with JSON only''),');
  d := replace(d, 'begin
  for j in', 'begin
  perform pg_advisory_xact_lock(hashtext(''sc_nix_suggest''));
  for j in');
  if position('>= 2;' in d) = 0 or position('sc_nix_lessons_text' in d) = 0 or position('pg_advisory_xact_lock' in d) = 0 then raise exception 'suggest patch missed'; end if;
  execute d;
end $$;

do $$
declare d text := pg_get_functiondef('public.sc_nix_suggest_batch'::regproc);
begin
  -- ask how sure it is
  d := replace(d, '"why":"..."}, ...]}', '"why":"...","sure":"high|medium|low"}, ...]}');
  d := replace(d, '{"n":1,"era":null,"why":"a few words"}', '{"n":1,"era":null,"why":"a few words","sure":"high|medium|low"}');
  d := replace(d, '{"n":1,"title":"clean title","producers":null,"featuring":null}', '{"n":1,"title":"clean title","producers":null,"featuring":null,"sure":"high|medium|low"}');
  d := replace(d, '{"n":1,"v":"yes|no|unsure","why":"a few words"}', '{"n":1,"v":"yes|no|unsure","why":"a few words","sure":"high|medium|low"}');
  d := replace(d, 'If the title named producers or featured artists', 'Also remove a leading track number ("13 - ", "04. "). If the title named producers or featured artists');
  d := replace(d, '- producers: who produced it', '- producers: who produced it (names only, never @handles or links)');
  if (length(d) - length(replace(d, '"sure":"high|medium|low"', ''))) / length('"sure":"high|medium|low"') <> 4 then raise exception 'batch patch missed'; end if;
  execute d;
end $$;

-- The moment the PC hands an answer back: save it and queue the next batch.
create or replace function public.sc_nix_job_finished()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  begin
    if new.kind like 'review:%' then perform sc_nix_review();
    elsif new.kind like 'suggest:%' then perform sc_nix_suggest(); end if;
  exception when others then null;  -- the minute tick picks it up instead
  end;
  return null;
end $$;
drop trigger if exists nix_job_finished on public.nix_ai_jobs;
create trigger nix_job_finished after update of status on public.nix_ai_jobs
  for each row when (old.status = 'running' and new.status in ('done', 'failed') and (new.kind like 'review:%' or new.kind like 'suggest:%'))
  execute function public.sc_nix_job_finished();

-- ------------------------------------------------------------- progress
create or replace function public.admin_nix_jobs_progress()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with kinds(kind, label, src) as (values
    ('duplicates', 'Duplicates notes', 'review'), ('cleanup', 'Clean-up notes', 'review'), ('mixups', 'Bio mix-up notes', 'review'),
    ('deezer', 'Deezer check notes', 'review'), ('titles', 'Titles', 'suggest'), ('audit', 'Version audit', 'suggest'),
    ('notes', 'Reading song notes', 'suggest'), ('eras', 'Eras', 'suggest'))
  select case when is_admin() then (select jsonb_agg(jsonb_build_object(
      'kind', k.kind, 'label', k.label,
      'done', (select count(*) from nix_notes n where n.kind = k.kind),
      'done_24h', (select count(*) from nix_notes n where n.kind = k.kind and n.created_at > now() - interval '24 hours'),
      'done_1h', (select count(*) from nix_notes n where n.kind = k.kind and n.created_at > now() - interval '1 hour'),
      'left', case k.kind
        when 'duplicates' then (select count(*) from duplicate_candidates d where cardinality(d.ids) > 1
                                 and not exists (select 1 from duplicate_dismissals dd where dd.group_id = d.group_id)
                                 and not exists (select 1 from nix_notes n where n.kind = 'duplicates' and n.item_key = d.group_id))
        when 'cleanup' then (select count(*) from tracks t where t.parent_track_id is null and sc_cleanup_kind(t.title) is not null
                              and not exists (select 1 from cleanup_kept c where c.track_id = t.id)
                              and not exists (select 1 from nix_notes n where n.kind = 'cleanup' and n.item_key = t.id))
        when 'mixups' then (select count(*) from artist_mixup_flags f where f.state = 'open'
                             and not exists (select 1 from nix_notes n where n.kind = 'mixups' and n.item_key = f.id::text))
        when 'deezer' then 0
        else (select count(*) from nix_work w where w.kind = k.kind) end,
      'suggested', (select count(*) from nix_suggestions s where s.kind = k.kind and s.state = 'open'),
      'agreed', case when k.src = 'suggest'
        then (select count(*) from nix_suggestions s where s.kind = k.kind and s.state = 'accepted' and s.decided_by is not null)
        else (select count(*) from nix_notes n where n.kind = k.kind and (sc_nix_review_outcome(k.kind, n.item_key) = n.verdict
              or (sc_nix_review_outcome(k.kind, n.item_key) = 'removed' and n.verdict in ('not_song', 'placeholder')))) end,
      'decided', case when k.src = 'suggest'
        then (select count(*) from nix_suggestions s where s.kind = k.kind and s.state in ('accepted', 'rejected') and s.decided_by is not null)
        else (select count(*) from nix_notes n where n.kind = k.kind and n.verdict <> 'unsure' and sc_nix_review_outcome(k.kind, n.item_key) is not null) end
    ) order by k.src, k.kind) from kinds k) end;
$$;
revoke all on function public.admin_nix_jobs_progress() from public, anon;
grant execute on function public.admin_nix_jobs_progress() to authenticated;

-- Surest first on the review page.
do $$
declare d text := pg_get_functiondef('public.admin_nix_suggestions(text, int)'::regprocedure);
begin
  d := replace(d, '''note'', s.note, ''model'', s.model) x', '''note'', s.note, ''model'', s.model, ''sure'', s.confidence) x');
  d := replace(d, 'order by a.name, t.title, s.field', 'order by case s.confidence when ''high'' then 0 when ''medium'' then 1 when ''low'' then 3 else 2 end, a.name, t.title, s.field');
  d := replace(d, 'jsonb_agg(x order by x->>''artist'', x->>''title'')', 'jsonb_agg(x)');
  if position('''sure'', s.confidence' in d) = 0 then raise exception 'list patch missed'; end if;
  execute d;
end $$;

-- ---------------------------------------------- offline warning in Alerts
do $$
declare d text := pg_get_functiondef('public.sc_background_check'::regproc);
declare anchor text := '  return v_failed;';
begin
  if position('nix_ai_workers' in d) > 0 then return; end if;
  if position(anchor in d) = 0 then raise exception 'anchor missing'; end if;
  d := replace(d, anchor, $add$
  -- the NIX PC was running in the last week but hasn't checked in for an hour
  if exists (select 1 from nix_ai_workers having max(last_seen) between now() - interval '7 days' and now() - interval '1 hour') then
    insert into notifications (user_id, kind, title, body, link, dedupe_key)
    select a, 'admin', 'NIX on your PC is offline', 'Your PC hasn''t checked in for over an hour (asleep, off, or the app closed). NIX''s AI jobs are paused until it''s back.',
           '/nix', 'nixpc:' || to_char(now(), 'YYYY-MM-DD')
    from sc_admin_ids(false) a on conflict do nothing;
  end if;
  return v_failed;$add$);
  execute d;
end $$;
