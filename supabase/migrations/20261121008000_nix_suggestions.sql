-- NIX's big jobs (only while a PC is running NIX: free). Each turns into
-- suggestions that a person accepts or rejects on /review/nix; accepting
-- applies them as one undoable batch. Nothing changes on its own.
--
--   notes   read song notes: leak date, producers, features, other names
--           (only fields that are empty, only what the notes actually say)
--   eras    unreleased songs with no era: pick one of the artist's known eras
--   audit   second opinion on sub-versions Claude linked automatically;
--           disagreements become "unlink?" suggestions
--   titles  titles with leftovers ([CDQ], (prod. X), .mp3): clean title,
--           producer/feature moved to their fields, old title kept as an alias
--
-- nix_work         what's left to look at (seeded here, topped up nightly)
-- nix_suggestions  what NIX proposes
-- sc_nix_suggest   the NIX job: saves finished answers, queues the next batch
--                  per kind (one at a time each, only while a PC is online)

create table if not exists public.nix_work (
  kind text not null,
  item_key text not null,
  group_key text,                -- eras: the artist (a batch is one artist's songs)
  pending_at timestamptz,        -- sent to the PC
  primary key (kind, item_key)
);
create index if not exists nix_work_next_idx on public.nix_work (kind, group_key, item_key) where pending_at is null;
alter table public.nix_work enable row level security;

create table if not exists public.nix_suggestions (
  id bigint generated always as identity primary key,
  kind text not null,
  track_id text not null,
  field text not null,           -- leak_date | producers | featured_artists | aliases | album | title | parent
  current_value text,
  suggested text not null,
  note text,
  model text,
  state text not null default 'open' check (state in ('open', 'accepted', 'rejected', 'stale')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  unique (kind, track_id, field)
);
create index if not exists nix_suggestions_open_idx on public.nix_suggestions (kind, state, created_at);
alter table public.nix_suggestions enable row level security;

-- ---- filling the work list ----
create or replace function public.sc_nix_work_seed()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a int; b int; c int; d int;
begin
  -- songs with notes worth reading, where something is still empty
  insert into nix_work (kind, item_key)
  select 'notes', t.id from tracks t
  where length(coalesce(t.notes, '')) >= 15
    and (t.leak_date is null or nullif(t.producers, '') is null or nullif(t.featured_artists, '') is null)
    and not exists (select 1 from nix_notes n where n.kind = 'notes' and n.item_key = t.id)
  on conflict do nothing;
  get diagnostics a = row_count;

  -- unreleased main songs with no era, for artists with 2+ eras known
  insert into nix_work (kind, item_key, group_key)
  select 'eras', t.id, t.artist_id from tracks t
  where t.parent_track_id is null and t.album is null
    and t.release_status in ('leaked', 'snippet', 'rumored', 'teased', 'unconfirmed')
    and t.artist_id in (select x.artist_id from tracks x where nullif(x.album, '') is not null group by x.artist_id having count(distinct x.album) >= 2)
    and not exists (select 1 from nix_notes n where n.kind = 'eras' and n.item_key = t.id)
  on conflict do nothing;
  get diagnostics b = row_count;

  -- sub-versions Claude linked on its own
  insert into nix_work (kind, item_key)
  select 'audit', vs.id::text from version_suggestions vs
  where vs.state = 'applied' and vs.ai_verdict = 'yes'
    and not exists (select 1 from nix_notes n where n.kind = 'audit' and n.item_key = vs.id::text)
  on conflict do nothing;
  get diagnostics c = row_count;

  -- titles with download leftovers
  insert into nix_work (kind, item_key)
  select 'titles', t.id from tracks t
  where t.title ~* '\[(cdq|hq|lq|og|leak|snippet)\]|\(prod\.|\.mp3|\.wav'
    and not exists (select 1 from nix_notes n where n.kind = 'titles' and n.item_key = t.id)
  on conflict do nothing;
  get diagnostics d = row_count;

  -- anything sent to a PC more than a day ago and never answered goes back
  update nix_work set pending_at = null where pending_at < now() - interval '1 day';
  return jsonb_build_object('notes', a, 'eras', b, 'audit', c, 'titles', d);
end $$;

-- ---- building a batch ----
create or replace function public.sc_nix_suggest_batch(p_kind text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare keys text[]; grp text; lines text; head text; eras text; v_prompt text;
begin
  if p_kind = 'eras' then
    select group_key into grp from nix_work where kind = 'eras' and pending_at is null order by group_key limit 1;
    if grp is null then return null; end if;
    select array_agg(item_key order by item_key) into keys from (
      select item_key from nix_work where kind = 'eras' and group_key = grp and pending_at is null order by item_key limit 15) s;
  else
    select array_agg(item_key order by item_key) into keys from (
      select item_key from nix_work where kind = p_kind and pending_at is null order by item_key
      limit case p_kind when 'notes' then 10 when 'audit' then 30 else 20 end) s;
  end if;
  if keys is null then return null; end if;

  if p_kind = 'notes' then
    select string_agg(format('%s. "%s" by %s (%s) | empty fields: %s | notes: "%s"', o.n, t.title, coalesce(a.name, '?'), t.release_status,
        concat_ws(', ', case when t.leak_date is null then 'leak_date' end, case when nullif(t.producers, '') is null then 'producers' end,
                  case when nullif(t.featured_artists, '') is null then 'featuring' end, 'other_names'),
        left(regexp_replace(t.notes, '\s+', ' ', 'g'), 700)), E'\n' order by o.n)
    into lines
    from unnest(keys) with ordinality o(k, n) join tracks t on t.id = o.k left join artists a on a.id = t.artist_id;
    head := 'You read the notes on songs in a fan music archive and pull out facts that the notes state plainly. Fill ONLY the fields listed as empty for that song, and ONLY with what the notes actually say. Never guess, never use outside knowledge.
- leak_date: the date the song leaked or surfaced, as YYYY-MM-DD, only when the notes give a full day, month and year. Otherwise null.
- producers: who produced it, comma separated, only when the notes say so ("prod. by", "produced by").
- featuring: featured artists, comma separated, only when the notes say so.
- other_names: other titles the song is known by ("aka", "also known as", "original title"), comma separated.
- why: a few words quoted from the notes that show it.
Use null for anything the notes don''t state.';
    v_prompt := head || E'\n\n' || lines || E'\n\nReply with JSON only: {"r":[{"n":1,"leak_date":null,"producers":null,"featuring":null,"other_names":null,"why":"..."}, ...]} covering every number.';
  elsif p_kind = 'eras' then
    select string_agg(format('"%s" (%s songs, %s)', e.album, e.n, coalesce(e.span, 'dates unknown')), '; ' order by e.first_d nulls last)
    into eras from (
      select x.album, count(*) n, min(coalesce(x.release_date, x.leak_date)) first_d,
        case when min(coalesce(x.release_date, x.leak_date)) is null then null
             else extract(year from min(coalesce(x.release_date, x.leak_date)))::int || case when extract(year from max(coalesce(x.release_date, x.leak_date))) <> extract(year from min(coalesce(x.release_date, x.leak_date)))
               then '-' || extract(year from max(coalesce(x.release_date, x.leak_date)))::int else '' end end span
      from tracks x where x.artist_id = grp and nullif(x.album, '') is not null group by x.album order by count(*) desc limit 40) e;
    select string_agg(format('%s. "%s" (%s)%s%s%s', o.n, t.title, t.release_status,
        case when t.leak_date is not null then ' | leaked ' || t.leak_date end,
        case when t.release_date is not null then ' | dated ' || t.release_date end,
        case when nullif(t.notes, '') is not null then ' | notes: "' || left(regexp_replace(t.notes, '\s+', ' ', 'g'), 250) || '"' else '' end), E'\n' order by o.n)
    into lines from unnest(keys) with ordinality o(k, n) join tracks t on t.id = o.k;
    head := format('These unreleased songs by %s have no era (album/period) yet. The artist''s known eras are: %s.
For each song, pick the era it belongs to ONLY when its notes, its dates or its title make it clear (for example the notes name the era or album, or the leak/recording date falls inside one era''s years and no other). Otherwise null. Only use an era name exactly as listed.',
      (select name from artists where id = grp), eras);
    v_prompt := head || E'\n\n' || lines || E'\n\nReply with JSON only: {"r":[{"n":1,"era":null,"why":"a few words"}, ...]} covering every number.';
  elsif p_kind = 'audit' then
    select string_agg(o.n || '. ' || coalesce(sc_version_line(o.k::uuid), '?'), E'\n' order by o.n) into lines
    from unnest(keys) with ordinality o(k, n);
    head := 'A music archive grouped each song below under a "main song" as one of its versions (an alternate take of the SAME composition). Check each one.
"yes": clearly a version of the same composition (numbered versions, demos, remixes, live, instrumentals, sped up/slowed, edits, snippets, OG/leak versions, freestyles of it).
"no": probably a different song: the main title is generic (Intro, Outro, Skit, Interlude, Untitled) and the tag is just an album/year label; a "Pt. 2" sequel; or unrelated songs that share a title.
"unsure": can''t tell.';
    v_prompt := head || E'\n\n' || lines || E'\n\nReply with JSON only: {"r":[{"n":1,"v":"yes|no|unsure","why":"a few words"}, ...]} covering every number.';
  else -- titles
    select string_agg(format('%s. title: "%s" | artist: %s | producers now: %s | featuring now: %s', o.n, t.title, coalesce(a.name, '?'),
        coalesce(nullif(t.producers, ''), '-'), coalesce(nullif(t.featured_artists, ''), '-')), E'\n' order by o.n)
    into lines from unnest(keys) with ordinality o(k, n) join tracks t on t.id = o.k left join artists a on a.id = t.artist_id;
    head := 'These song titles in a music archive have leftovers from file names or leak sites. For each, give the clean song title: remove tags like [CDQ], [HQ], [LQ], [OG], [Leak], [Snippet], file extensions (.mp3, .wav), "(prod. X)" and "(feat. X)". Keep real version names such as "(Remix)", "[V2]", "(Demo)" or "(Live)".
If the title named producers or featured artists, list them (comma separated), otherwise null.';
    v_prompt := head || E'\n\n' || lines || E'\n\nReply with JSON only: {"r":[{"n":1,"title":"clean title","producers":null,"featuring":null}, ...]} covering every number.';
  end if;

  return jsonb_build_object('keys', to_jsonb(keys), 'group', grp, 'prompt', v_prompt);
end $$;

-- ---- saving answers ----
create or replace function public.sc_nix_suggest_save(p_kind text, p_key text, p_group text, r jsonb, p_model text)
returns int language plpgsql security definer set search_path to 'public' as $$
declare t tracks; n int := 0; val text; vs version_suggestions; pt text;
begin
  if p_kind = 'audit' then
    select * into vs from version_suggestions where id = p_key::uuid;
    if found and lower(r ->> 'v') = 'no' then
      select * into t from tracks where id = vs.track_id;
      if found and t.parent_track_id is not null then
        select title into pt from tracks where id = t.parent_track_id;
        insert into nix_suggestions (kind, track_id, field, current_value, suggested, note, model)
        values ('audit', t.id, 'parent', pt, 'unlink', left(r ->> 'why', 200), p_model)
        on conflict (kind, track_id, field) do nothing;
        n := 1;
      end if;
    end if;
    return n;
  end if;

  select * into t from tracks where id = p_key;
  if not found then return 0; end if;

  if p_kind = 'notes' then
    val := r ->> 'leak_date';
    if t.leak_date is null and val ~ '^\d{4}-\d{2}-\d{2}$' then
      begin
        if val::date between date '1990-01-01' and current_date then
          insert into nix_suggestions (kind, track_id, field, current_value, suggested, note, model)
          values ('notes', t.id, 'leak_date', null, val, left(r ->> 'why', 200), p_model) on conflict do nothing;
          n := n + 1;
        end if;
      exception when others then null; end;
    end if;
    val := nullif(trim(r ->> 'producers'), '');
    if nullif(t.producers, '') is null and val is not null and length(val) <= 200 and lower(val) not in ('null', 'none', 'unknown') then
      insert into nix_suggestions (kind, track_id, field, current_value, suggested, note, model)
      values ('notes', t.id, 'producers', null, val, left(r ->> 'why', 200), p_model) on conflict do nothing;
      n := n + 1;
    end if;
    val := nullif(trim(r ->> 'featuring'), '');
    if nullif(t.featured_artists, '') is null and val is not null and length(val) <= 200 and lower(val) not in ('null', 'none', 'unknown') then
      insert into nix_suggestions (kind, track_id, field, current_value, suggested, note, model)
      values ('notes', t.id, 'featured_artists', null, val, left(r ->> 'why', 200), p_model) on conflict do nothing;
      n := n + 1;
    end if;
    val := nullif(trim(r ->> 'other_names'), '');
    if val is not null and length(val) <= 150 and lower(val) not in ('null', 'none', 'unknown') and lower(val) <> lower(t.title)
       and position(lower(val) in lower(coalesce(t.aliases, ''))) = 0 then
      insert into nix_suggestions (kind, track_id, field, current_value, suggested, note, model)
      values ('notes', t.id, 'aliases', t.aliases, val, left(r ->> 'why', 200), p_model) on conflict do nothing;
      n := n + 1;
    end if;
  elsif p_kind = 'eras' then
    val := nullif(trim(r ->> 'era'), '');
    if t.album is null and val is not null then
      select x.album into val from tracks x where x.artist_id = coalesce(p_group, t.artist_id) and lower(x.album) = lower(val) limit 1;
      if val is not null then
        insert into nix_suggestions (kind, track_id, field, current_value, suggested, note, model)
        values ('eras', t.id, 'album', null, val, left(r ->> 'why', 200), p_model) on conflict do nothing;
        n := 1;
      end if;
    end if;
  elsif p_kind = 'titles' then
    val := nullif(trim(r ->> 'title'), '');
    if val is not null and val <> t.title and length(val) between 1 and 200 then
      insert into nix_suggestions (kind, track_id, field, current_value, suggested, note, model)
      values ('titles', t.id, 'title', t.title, val, 'Old title kept as another name', p_model) on conflict do nothing;
      n := n + 1;
    end if;
    val := nullif(trim(r ->> 'producers'), '');
    if nullif(t.producers, '') is null and val is not null and length(val) <= 200 and lower(val) not in ('null', 'none') then
      insert into nix_suggestions (kind, track_id, field, current_value, suggested, note, model)
      values ('titles', t.id, 'producers', null, val, 'From the title', p_model) on conflict do nothing;
      n := n + 1;
    end if;
    val := nullif(trim(r ->> 'featuring'), '');
    if nullif(t.featured_artists, '') is null and val is not null and length(val) <= 200 and lower(val) not in ('null', 'none') then
      insert into nix_suggestions (kind, track_id, field, current_value, suggested, note, model)
      values ('titles', t.id, 'featured_artists', null, val, 'From the title', p_model) on conflict do nothing;
      n := n + 1;
    end if;
  end if;
  return n;
end $$;

-- ---- the NIX job ----
create or replace function public.sc_nix_suggest()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare j record; ans jsonb; r jsonb; k text; idx int; done_keys text[]; made int := 0; queued int := 0; b jsonb; v_kind text;
begin
  for j in
    update nix_ai_jobs set status = 'collected'
    where id in (select id from nix_ai_jobs where kind like 'suggest:%' and status in ('done', 'failed') order by id limit 20 for update skip locked)
    returning kind, payload, output, error, model
  loop
    v_kind := substring(j.kind from 9);
    done_keys := '{}';
    if j.error is null and j.output is not null then
      begin ans := substring(j.output from '\{.*\}')::jsonb; exception when others then ans := null; end;
      for r in select value from jsonb_array_elements(coalesce(ans -> 'r', '[]')) loop
        begin idx := (r ->> 'n')::int; exception when others then idx := null; end;
        continue when idx is null;
        k := j.payload -> 'keys' ->> (idx - 1);
        continue when k is null;
        made := made + sc_nix_suggest_save(v_kind, k, j.payload ->> 'group', r, j.model);
        insert into nix_notes (kind, item_key, verdict, note, model)
        values (v_kind, k, coalesce(left(lower(r ->> 'v'), 20), 'read'), left(coalesce(r ->> 'why', r ->> 'era', r ->> 'title'), 200), j.model)
        on conflict (kind, item_key) do update set verdict = excluded.verdict, note = excluded.note, model = excluded.model, created_at = now();
        done_keys := done_keys || k;
      end loop;
    end if;
    -- answered: off the work list; not answered: back in line
    delete from nix_work w where w.kind = substring(j.kind from 9) and w.item_key = any (done_keys);
    update nix_work w set pending_at = null
    where w.kind = substring(j.kind from 9) and w.item_key in (select jsonb_array_elements_text(j.payload -> 'keys')) and not (w.item_key = any (done_keys));
  end loop;

  if sc_nix_ai_online() then
    foreach v_kind in array array['titles', 'audit', 'notes', 'eras'] loop
      continue when exists (select 1 from nix_ai_jobs x where x.kind = 'suggest:' || v_kind and x.status in ('queued', 'running'));
      b := sc_nix_suggest_batch(v_kind);
      continue when b is null;
      update nix_work w set pending_at = now() where w.kind = v_kind and w.item_key in (select jsonb_array_elements_text(b -> 'keys'));
      insert into nix_ai_jobs (kind, prompt, payload, json_reply)
      values ('suggest:' || v_kind, b ->> 'prompt', jsonb_build_object('keys', b -> 'keys', 'group', b -> 'group'), true);
      queued := queued + 1;
    end loop;
  end if;
  return jsonb_build_object('suggested', made, 'queued', queued);
end $$;

revoke all on function public.sc_nix_work_seed(), public.sc_nix_suggest_batch(text), public.sc_nix_suggest_save(text, text, text, jsonb, text),
  public.sc_nix_suggest() from public, anon, authenticated;

insert into public.nix_tasks (name, steps, every, max_every, only_if, at_time) values
  ('nix-suggest', '[{"name":"suggest","sql":"public.sc_nix_suggest()"}]', '1 min', '1 min',
   'public.sc_nix_ai_online() or exists (select 1 from public.nix_ai_jobs where kind like ''suggest:%'' and status in (''done'', ''failed''))', null),
  ('nix-work-seed', '[{"name":"added","sql":"public.sc_nix_work_seed()"}]', '1 day', '1 day', null, '05:05')
on conflict (name) do nothing;
update public.nix_tasks set next_at = date_trunc('day', now()) + interval '1 day' + time '05:05' where name = 'nix-work-seed' and last_run_at is null;

-- ---- the review page ----
create or replace function public.admin_nix_suggestions(p_kind text, p_limit int default 200)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when is_moderator() then jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(kind, n), '{}') from (select kind, count(*) n from nix_suggestions where state = 'open' group by kind) c),
    'left', (select coalesce(jsonb_object_agg(kind, n), '{}') from (select kind, count(*) n from nix_work group by kind) w),
    'items', (select coalesce(jsonb_agg(x order by x->>'artist', x->>'title'), '[]') from (
      select jsonb_build_object('id', s.id, 'track_id', s.track_id, 'title', t.title, 'artist_id', t.artist_id, 'artist', a.name,
        'status', t.release_status, 'field', s.field, 'current', s.current_value, 'suggested', s.suggested, 'note', s.note, 'model', s.model) x
      from nix_suggestions s join tracks t on t.id = s.track_id left join artists a on a.id = t.artist_id
      where s.kind = p_kind and s.state = 'open'
      order by a.name, t.title, s.field
      limit greatest(1, least(coalesce(p_limit, 200), 1000))) q))
  end;
$$;
revoke all on function public.admin_nix_suggestions(text, int) from public, anon;
grant execute on function public.admin_nix_suggestions(text, int) to authenticated;

-- Accept (apply, one undoable batch) or reject suggestions.
create or replace function public.admin_nix_suggestions_decide(p_ids bigint[], p_accept boolean)
returns int language plpgsql security definer set search_path to 'public' as $$
declare s record; n int := 0; applied boolean;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if not p_accept then
    update nix_suggestions set state = 'rejected', decided_at = now(), decided_by = auth.uid() where id = any (p_ids) and state = 'open';
    get diagnostics n = row_count;
    return n;
  end if;
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('nix', 'NIX suggestions: ' || cardinality(p_ids) || ' accepted');
  for s in select * from nix_suggestions where id = any (p_ids) and state = 'open' order by id loop
    applied := false;
    if s.field = 'leak_date' then
      update tracks set leak_date = s.suggested::date where id = s.track_id and leak_date is null; applied := found;
    elsif s.field = 'producers' then
      update tracks set producers = s.suggested where id = s.track_id and nullif(producers, '') is null; applied := found;
    elsif s.field = 'featured_artists' then
      update tracks set featured_artists = s.suggested where id = s.track_id and nullif(featured_artists, '') is null; applied := found;
    elsif s.field = 'aliases' then
      update tracks set aliases = nullif(trim(both ', ' from coalesce(aliases, '') || ', ' || s.suggested), '') where id = s.track_id; applied := found;
    elsif s.field = 'album' then
      update tracks set album = s.suggested where id = s.track_id and album is null; applied := found;
    elsif s.field = 'title' then
      update tracks set aliases = nullif(trim(both ', ' from coalesce(aliases, '') || ', ' || title), ''), title = s.suggested
      where id = s.track_id and title = s.current_value; applied := found;
    elsif s.field = 'parent' then
      update tracks set parent_track_id = null where id = s.track_id and parent_track_id is not null; applied := found;
    end if;
    update nix_suggestions set state = case when applied then 'accepted' else 'stale' end, decided_at = now(), decided_by = auth.uid() where id = s.id;
    if applied then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.admin_nix_suggestions_decide(bigint[], boolean) from public, anon;
grant execute on function public.admin_nix_suggestions_decide(bigint[], boolean) to authenticated;

select public.sc_nix_work_seed();
