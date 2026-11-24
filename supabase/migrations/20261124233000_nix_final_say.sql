-- Nathan, 24 Nov: "work through NIX and Claude disagreements, select the
-- correct option, reteach NIX".
--
-- Final say: every item where Claude's check disagreed with NIX goes to a
-- second, more careful Claude pass (thinking on, both answers in front of
-- it) that picks who was right and the correct answer:
--   NIX was right       -> the suggestion moves to "Claude agrees"
--   checker right/both wrong, answer is "nothing / no era / keep linked"
--                       -> the suggestion is dismissed (no song changes)
--   a different, usable answer -> kept as "Claude corrected": accepting it
--                          saves the corrected value instead of NIX's
--   can't tell          -> stays in "Claude disagrees"
-- Review notes (duplicates, clean-up, bios, Deezer) keep the final answer
-- next to NIX's note. Nothing on the site changes by itself.
--
-- Reteach: NIX's prompts now learn from these final answers (where it was
-- wrong, and a couple where it was right) after the owner's own decisions.

lock table public.nix_notes, public.nix_suggestions in access exclusive mode;

alter table public.nix_suggestions
  add column if not exists final_side text, add column if not exists final_answer text,
  add column if not exists final_note text, add column if not exists judged_at timestamptz,
  add column if not exists judge_claim_at timestamptz, add column if not exists corrected text;
alter table public.nix_notes
  add column if not exists final_side text, add column if not exists final_answer text,
  add column if not exists final_note text, add column if not exists judged_at timestamptz,
  add column if not exists judge_claim_at timestamptz;

create index if not exists nix_suggestions_tojudge_idx on public.nix_suggestions (kind, created_at) where check_verdict = 'disagree' and judged_at is null and state = 'open';
create index if not exists nix_notes_tojudge_idx on public.nix_notes (kind, created_at) where check_verdict = 'disagree' and judged_at is null;

-- A re-answered note needs checking and judging again.
create or replace function public.sc_nix_note_changed()
returns trigger language plpgsql as $$
begin
  if new.verdict is distinct from old.verdict or new.note is distinct from old.note then
    new.check_verdict := null; new.check_answer := null; new.check_note := null; new.checked_at := null; new.check_claim_at := null;
    new.final_side := null; new.final_answer := null; new.final_note := null; new.judged_at := null; new.judge_claim_at := null;
  end if;
  return new;
end $$;

-- The next disagreements to judge, one kind at a time.
create or replace function public.sc_nix_judge_batch(p_secret text, p_limit int default 15)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare items jsonb := '[]'; v_kind text; lines text;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;

  select kind into v_kind from nix_suggestions
  where state = 'open' and check_verdict = 'disagree' and judged_at is null
    and (judge_claim_at is null or judge_claim_at < now() - interval '5 minutes')
  order by created_at limit 1;
  if v_kind is not null then
    with picked as (
      select id from nix_suggestions
      where kind = v_kind and state = 'open' and check_verdict = 'disagree' and judged_at is null
        and (judge_claim_at is null or judge_claim_at < now() - interval '5 minutes')
      order by created_at, id limit least(p_limit, 15) for update skip locked)
    update nix_suggestions s set judge_claim_at = clock_timestamp() from picked where s.id = picked.id;
    select coalesce(jsonb_agg(jsonb_build_object('key', 's:' || s.id,
             'line', sc_nix_check_line(s.id) || ' | CHECKER says: NIX is wrong; right answer: "' || coalesce(s.check_answer, '?') || '" (' || coalesce(s.check_note, '-') || ')')
             order by s.created_at, s.id), '[]')
    into items from nix_suggestions s
    where s.kind = v_kind and s.state = 'open' and s.judged_at is null and s.judge_claim_at >= now();
  else
    select kind into v_kind from nix_notes
    where check_verdict = 'disagree' and judged_at is null and line is not null
      and (judge_claim_at is null or judge_claim_at < now() - interval '5 minutes')
    order by array_position(array['cleanup', 'mixups', 'deezer', 'duplicates'], kind), created_at limit 1;
    if v_kind is null then return null; end if;
    with picked as (
      select kind, item_key from nix_notes
      where kind = v_kind and check_verdict = 'disagree' and judged_at is null and line is not null
        and (judge_claim_at is null or judge_claim_at < now() - interval '5 minutes')
      order by created_at limit least(p_limit, 15) for update skip locked)
    update nix_notes n set judge_claim_at = clock_timestamp() from picked where n.kind = picked.kind and n.item_key = picked.item_key;
    select coalesce(jsonb_agg(jsonb_build_object('key', 'n:' || n.kind || ':' || n.item_key,
             'line', n.line || ' | NIX says: ' || n.verdict || coalesce(' (' || n.note || ')', '')
               || ' | CHECKER says: ' || coalesce(n.check_answer, '?') || ' (' || coalesce(n.check_note, '-') || ')') order by n.created_at), '[]')
    into items from nix_notes n
    where n.kind = v_kind and n.judged_at is null and n.judge_claim_at >= now();
  end if;

  items := (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(items) x where x ->> 'line' is not null);
  if jsonb_array_length(items) = 0 then return null; end if;
  select string_agg(o.n || '. ' || (o.x ->> 'line'), E'\n' order by o.n) into lines
  from jsonb_array_elements(items) with ordinality o(x, n);

  return jsonb_build_object('stage', 'judge', 'kind', v_kind,
    'keys', (select jsonb_agg(x -> 'key') from jsonb_array_elements(items) x),
    'prompt', 'You have the final say for a fan music archive (released songs, leaks, snippets, unreleased eras). For each numbered item, a small AI (NIX) gave an answer and a checker disagreed. Look at the evidence yourself, carefully, and decide who is right. Use only the information given plus well-known facts about music releases. Do not side with the checker just because it is the checker: it is often wrong too.'
      || E'\n\n' || sc_nix_check_rules(v_kind) || E'\n\n' || lines
      || E'\n\nReply with exactly one line per item and nothing else, in this form:\n1|nix|<why, under 15 words>\n2|checker|<the correct answer>|<why, under 15 words>\n3|neither|<the correct answer>|<why, under 15 words>\n4|unsure|<why, under 15 words>\n'
      || 'Use "nix" when NIX''s answer is right, "checker" when the checker''s answer is right, "neither" when both are wrong. The correct answer must be written the way NIX would write it (an era name, a YYYY-MM-DD date, names, or one of the allowed words), or "nothing" when nothing should change.');
end $$;

-- Save the final say.
create or replace function public.sc_nix_judge_save(p_secret text, p_keys jsonb, p_items jsonb)
returns int language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; k text; side text; ans text; why text; n int := 0; kd text; ik text; s record; usable boolean;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  for r in select value from jsonb_array_elements(coalesce(p_items, '[]')) loop
    k := p_keys ->> ((r ->> 'n')::int - 1);
    side := lower(r ->> 'side');
    continue when k is null or side not in ('nix', 'checker', 'neither', 'unsure');
    ans := nullif(btrim(left(r ->> 'answer', 200), ' "'''), '');
    why := left(nullif(r ->> 'why', ''), 200);
    if k like 's:%' then
      select * into s from nix_suggestions where id = substring(k from 3)::bigint and state = 'open';
      continue when not found;
      if side in ('checker', 'neither') and sc_nix_same_answer(ans, s.suggested) then side := 'nix'; end if;
      update nix_suggestions set final_side = side, final_answer = case when side = 'nix' then null else ans end, final_note = why,
        judged_at = now(), judge_claim_at = null where id = s.id;
      if side = 'nix' then
        update nix_suggestions set check_verdict = 'agree' where id = s.id;
      elsif side in ('checker', 'neither') then
        usable := ans is not null and lower(ans) !~ '^(nothing|none|null|no era|no change|keep linked|n/?a|-)\.?$'
          and s.field <> 'parent'
          and case s.field
                when 'leak_date' then ans ~ '^\d{4}-\d{2}-\d{2}$'
                when 'album' then exists (select 1 from tracks x join tracks t on t.id = s.track_id
                                          where x.artist_id = t.artist_id and x.album = ans)
                else length(ans) between 1 and 200 end;
        if usable then
          update nix_suggestions set check_verdict = 'corrected', corrected = ans where id = s.id;
        else
          update nix_suggestions set state = 'rejected', decided_at = now() where id = s.id;
        end if;
      end if;
    else
      kd := split_part(k, ':', 2);
      ik := substring(k from length(kd) + 4);
      update nix_notes set final_side = side, final_answer = case when side = 'nix' then verdict else ans end, final_note = why,
        judged_at = now(), judge_claim_at = null
      where kind = kd and item_key = ik;
    end if;
    n := n + 1;
  end loop;
  update nix_suggestions set judge_claim_at = null
  where judged_at is null and id in (select substring(x from 3)::bigint from jsonb_array_elements_text(p_keys) x where x like 's:%');
  update nix_notes nn set judge_claim_at = null
  from (select split_part(x, ':', 2) kd, substring(x from length(split_part(x, ':', 2)) + 4) ik from jsonb_array_elements_text(p_keys) x where x like 'n:%') q
  where nn.judged_at is null and nn.kind = q.kd and nn.item_key = q.ik;
  return n;
end $$;
revoke all on function public.sc_nix_judge_batch(text, int), public.sc_nix_judge_save(text, jsonb, jsonb) from public, anon, authenticated;

-- Accepting a corrected suggestion saves the corrected value.
do $$
declare d text := pg_get_functiondef('public.admin_nix_suggestions_decide'::regproc);
begin
  d := replace(d, 's.suggested', 'coalesce(s.corrected, s.suggested)');
  if position('coalesce(s.corrected, s.suggested)' in d) = 0 then raise exception 'decide patch missed'; end if;
  execute d;
end $$;

-- Review page: the corrected pile and the final say.
create or replace function public.admin_nix_suggestions(p_kind text, p_limit int default 200, p_pile text default null)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when is_moderator() then jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(kind, n), '{}') from (select kind, count(*) n from nix_suggestions where state = 'open' group by kind) c),
    'left', (select coalesce(jsonb_object_agg(kind, n), '{}') from (select kind, count(*) n from nix_work group by kind) w),
    'piles', (select jsonb_build_object(
        'agree', count(*) filter (where check_verdict = 'agree'),
        'corrected', count(*) filter (where check_verdict = 'corrected'),
        'disagree', count(*) filter (where check_verdict = 'disagree'),
        'unsure', count(*) filter (where check_verdict = 'unsure'),
        'unchecked', count(*) filter (where check_verdict is null))
      from nix_suggestions where kind = p_kind and state = 'open'),
    'items', (select coalesce(jsonb_agg(x), '[]') from (
      select jsonb_build_object('id', s.id, 'track_id', s.track_id, 'title', t.title, 'artist_id', t.artist_id, 'artist', a.name,
        'status', t.release_status, 'field', s.field, 'current', s.current_value, 'suggested', s.suggested, 'note', s.note, 'model', s.model,
        'sure', s.confidence, 'check', s.check_verdict, 'check_answer', s.check_answer, 'check_note', s.check_note,
        'corrected', s.corrected, 'final_side', s.final_side, 'final_note', s.final_note) x
      from nix_suggestions s join tracks t on t.id = s.track_id left join artists a on a.id = t.artist_id
      where s.kind = p_kind and s.state = 'open'
        and (p_pile is null or (p_pile = 'unchecked' and s.check_verdict is null) or s.check_verdict = p_pile)
      order by case s.confidence when 'high' then 0 when 'medium' then 1 when 'low' then 3 else 2 end, a.name, t.title, s.field
      limit greatest(1, least(coalesce(p_limit, 200), 1000))) q))
  end;
$$;

create or replace function public.admin_nix_notes(p_kind text, p_keys text[])
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when is_moderator() then coalesce((select jsonb_object_agg(item_key, jsonb_build_object('verdict', verdict, 'note', note, 'model', model,
      'check', check_verdict, 'check_answer', check_answer, 'check_note', check_note,
      'final_side', final_side, 'final_answer', final_answer, 'final_note', final_note))
    from nix_notes where kind = p_kind and item_key = any (p_keys[1:500])), '{}') end;
$$;

-- nix-check also runs while there are disagreements to judge.
update public.nix_tasks set only_if =
  'exists (select 1 from public.nix_suggestions where state = ''open'' and checked_at is null)'
  || ' or exists (select 1 from public.nix_notes where line is not null and checked_at is null and kind in (''cleanup'', ''mixups'', ''deezer'', ''duplicates''))'
  || ' or exists (select 1 from public.nix_suggestions where state = ''open'' and check_verdict = ''disagree'' and judged_at is null)'
  || ' or exists (select 1 from public.nix_notes where check_verdict = ''disagree'' and judged_at is null and line is not null)'
where name = 'nix-check';

-- ------------------------------------------------------------- reteach
-- What NIX's prompts learn from, in order: the owner's own decisions, then
-- the final say on its mistakes (with the right answer), then a couple of
-- cases where it was right and the checker wasn't (so it doesn't overcorrect).
create or replace function public.sc_nix_lessons_text(p_kind text, p_n int default 8)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare v text; c text; ok text; outv text := '';
begin
  if p_kind in ('notes', 'eras', 'audit', 'titles') then
    select string_agg(format('- "%s" by %s | %s: %s -> the owner %s', t.title, coalesce(a.name, '?'), s.field,
             case when s.field = 'parent' then 'unlink from "' || coalesce(s.current_value, '?') || '"' else s.suggested end,
             case s.state when 'accepted' then 'ACCEPTED this' else 'REJECTED this' end), E'\n')
    into v from (
      select * from nix_suggestions where kind = p_kind and state in ('accepted', 'rejected') and decided_by is not null
      order by (state = 'rejected') desc, decided_at desc limit p_n) s
    join tracks t on t.id = s.track_id left join artists a on a.id = t.artist_id;
    select string_agg(format('- "%s" by %s | %s: %s -> WRONG. Right answer: %s (%s)', t.title, coalesce(a.name, '?'), s.field,
             case when s.field = 'parent' then 'unlink from "' || coalesce(s.current_value, '?') || '"' else s.suggested end,
             coalesce(case when s.field = 'parent' then 'keep linked' end, s.final_answer, 'leave it empty'), coalesce(s.final_note, '-')), E'\n')
    into c from (
      select * from nix_suggestions where kind = p_kind and final_side in ('checker', 'neither') and decided_by is null
      order by judged_at desc limit 6) s
    join tracks t on t.id = s.track_id left join artists a on a.id = t.artist_id;
    select string_agg(format('- "%s" by %s | %s: %s -> RIGHT (%s)', t.title, coalesce(a.name, '?'), s.field, s.suggested, coalesce(s.final_note, '-')), E'\n')
    into ok from (
      select * from nix_suggestions where kind = p_kind and final_side = 'nix' and field <> 'parent'
      order by judged_at desc limit 2) s
    join tracks t on t.id = s.track_id left join artists a on a.id = t.artist_id;
  else
    if p_kind in ('duplicates', 'cleanup') then
      select string_agg(format('- %s -> the owner decided: %s', x.line, x.outcome), E'\n') into v from (
        select n.line, sc_nix_review_outcome(p_kind, n.item_key) outcome, n.verdict from nix_notes n
        where n.kind = p_kind and n.line is not null and n.created_at > now() - interval '60 days'
        order by n.created_at desc limit 400) x
      where x.outcome is not null
        and not (x.outcome = x.verdict or (x.outcome = 'removed' and x.verdict in ('not_song', 'placeholder')))
      limit p_n;
    end if;
    select string_agg(format('- %s -> you said "%s"; the right answer is "%s" (%s)', n.line, n.verdict, coalesce(n.final_answer, '?'), coalesce(n.final_note, '-')), E'\n')
    into c from (
      select * from nix_notes where kind = p_kind and final_side in ('checker', 'neither') and line is not null and final_answer is not null
      order by judged_at desc limit 6) n;
    select string_agg(format('- %s -> "%s" was RIGHT (%s)', n.line, n.verdict, coalesce(n.final_note, '-')), E'\n')
    into ok from (
      select * from nix_notes where kind = p_kind and final_side = 'nix' and line is not null
      order by judged_at desc limit 2) n;
  end if;
  if v is not null then
    outv := E'\n\nRecent decisions by the archive''s owner on cases like these (follow the same judgement):\n' || v;
  end if;
  if c is not null then
    outv := outv || E'\n\nYour recent answers that were checked and found WRONG, with the right answer (learn from them):\n' || c;
  end if;
  if ok is not null then
    outv := outv || E'\n\nAnd some you got right (keep doing this):\n' || ok;
  end if;
  return outv;
end $$;

-- An era the final say names is matched to the artist's own spelling of it.
do $$
declare d text := pg_get_functiondef('public.sc_nix_judge_save'::regproc);
begin
  d := replace(d, 'where x.artist_id = t.artist_id and x.album = ans)', 'where x.artist_id = t.artist_id and lower(x.album) = lower(ans))');
  d := replace(d, '        if usable then
          update nix_suggestions set check_verdict = ''corrected'', corrected = ans where id = s.id;',
'        if usable and s.field = ''album'' then
          select x.album into ans from tracks x join tracks t on t.id = s.track_id
          where x.artist_id = t.artist_id and lower(x.album) = lower(ans) group by x.album order by count(*) desc limit 1;
        end if;
        if usable then
          update nix_suggestions set check_verdict = ''corrected'', corrected = ans where id = s.id;');
  if position('lower(x.album) = lower(ans) group by' in d) = 0 then raise exception 'patch missed'; end if;
  execute d;
end $$;

-- Reteach, from the first final-say results on "from notes": the clearest
-- repeated mistakes go straight into the instructions.
do $$
declare d text := pg_get_functiondef('public.sc_nix_suggest_batch'::regproc);
begin
  d := replace(d, '- other_names: other titles the song is known by ("aka", "also known as", "original title"), comma separated.',
    '- other_names: other titles the song is known by ("aka", "also known as", "original title"), comma separated. An "OG Filename" or file name is NOT another name, and neither is the song''''s own title.');
  d := replace(d, '- producers: who produced it (names only, never @handles or links), comma separated, only when the notes say so ("prod. by", "produced by").',
    '- producers: who produced it (names only, never @handles or links), comma separated, only when the notes say so ("prod. by", "produced by"). Engineers, mixers and people "in the studio" are not producers.');
  d := replace(d, '- featuring: featured artists, comma separated, only when the notes say so.',
    '- featuring: featured artists, comma separated, only when the notes say they are ON the song. Being seen in the studio together is not a feature.');
  d := replace(d, '- leak_date: the date the song leaked or surfaced, as YYYY-MM-DD, only when the notes give a full day, month and year. Otherwise null.',
    '- leak_date: the date the song leaked or surfaced, as YYYY-MM-DD, only when the notes give a full day, month and year. A release, re-release or upload date is not a leak date. Otherwise null.');
  if position('OG Filename" or file name is NOT another name' in d) = 0 or position('re-release or upload date' in d) = 0 then raise exception 'patch missed'; end if;
  execute d;
end $$;
