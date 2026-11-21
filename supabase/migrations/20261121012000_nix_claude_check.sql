-- Claude checks NIX's work. Every suggestion NIX makes, and every review note
-- (duplicates, clean-up, bio mix-ups, Deezer), is checked by Claude (Haiku)
-- with the nix-check job. Claude says agree / disagree / unsure (and, when it
-- disagrees, what the right answer is). Nothing changes because of it:
-- - /review/nix splits suggestions into "Claude agrees", "Claude disagrees",
--   "Claude unsure" and "not checked yet";
-- - review pages show Claude's view next to NIX's note;
-- - Claude's disagreements go into NIX's next prompts as worked examples
--   (after the owner's own decisions, which always come first);
-- - /nix shows how often Claude agrees with each job.
-- Claude's budget goes up to about £10 a month (Nathan, 21 Nov). The checking
-- is background work, so it stays inside the background share and Local
-- Cuts always keeps its room.

lock table public.nix_ai_jobs, public.nix_work, public.nix_notes, public.nix_suggestions in access exclusive mode;

-- ------------------------------------------------------------- budget
insert into public.sc_private_settings (key, value) values ('claude_month_usd', '10.40')
on conflict (key) do update set value = excluded.value;

-- ------------------------------------------------------------- columns
alter table public.nix_suggestions
  add column if not exists check_verdict text,
  add column if not exists check_answer text,
  add column if not exists check_note text,
  add column if not exists checked_at timestamptz,
  add column if not exists check_claim_at timestamptz;
alter table public.nix_notes
  add column if not exists check_verdict text,
  add column if not exists check_answer text,
  add column if not exists check_note text,
  add column if not exists checked_at timestamptz,
  add column if not exists check_claim_at timestamptz;

create index if not exists nix_suggestions_tocheck_idx on public.nix_suggestions (created_at, id) where state = 'open' and checked_at is null;
create index if not exists nix_notes_tocheck_idx on public.nix_notes (kind, created_at) where checked_at is null and line is not null;
create index if not exists nix_notes_checked_idx on public.nix_notes (kind, check_verdict) where checked_at is not null;

-- A note NIX re-answers needs checking again.
create or replace function public.sc_nix_note_changed()
returns trigger language plpgsql as $$
begin
  if new.verdict is distinct from old.verdict or new.note is distinct from old.note then
    new.check_verdict := null; new.check_answer := null; new.check_note := null; new.checked_at := null; new.check_claim_at := null;
  end if;
  return new;
end $$;
drop trigger if exists nix_note_changed on public.nix_notes;
create trigger nix_note_changed before update on public.nix_notes for each row execute function public.sc_nix_note_changed();

-- ------------------------------------------------------------- what Claude reads
-- One line per suggestion: what NIX looked at and what it said.
create or replace function public.sc_nix_check_line(p_id bigint)
returns text language sql stable security definer set search_path to 'public' as $$
  select case s.kind
    when 'audit' then format('artist: %s | song: "%s" (%s) | filed as a version of: "%s" | NIX says: NOT a version of it, unlink. Why: %s',
      coalesce(a.name, '?'), t.title, coalesce(t.release_status, '?'), coalesce(s.current_value, '?'), coalesce(s.note, '-'))
    when 'eras' then format('artist: %s | song: "%s" (%s)%s%s%s | NIX says: era "%s"%s. Why: %s',
      coalesce(a.name, '?'), t.title, coalesce(t.release_status, '?'),
      case when t.leak_date is not null then ' | leaked ' || t.leak_date end,
      case when t.release_date is not null then ' | dated ' || t.release_date end,
      case when nullif(t.notes, '') is not null then ' | notes: "' || left(regexp_replace(t.notes, '\s+', ' ', 'g'), 300) || '"' else '' end,
      s.suggested,
      (select ' (that era''s songs date ' || coalesce(min(extract(year from coalesce(x.release_date, x.leak_date)))::int::text, '?')
              || case when max(extract(year from coalesce(x.release_date, x.leak_date))) > min(extract(year from coalesce(x.release_date, x.leak_date)))
                      then '-' || max(extract(year from coalesce(x.release_date, x.leak_date)))::int else '' end || ')'
       from tracks x where x.artist_id = t.artist_id and x.album = s.suggested),
      coalesce(s.note, '-'))
    when 'notes' then format('artist: %s | song: "%s" | notes: "%s" | NIX says: %s = "%s". Why: %s',
      coalesce(a.name, '?'), t.title, left(regexp_replace(coalesce(t.notes, ''), '\s+', ' ', 'g'), 600),
      case s.field when 'leak_date' then 'leak date' when 'featured_artists' then 'featuring' when 'aliases' then 'other names' else s.field end,
      s.suggested, coalesce(s.note, '-'))
    else format('artist: %s | title now: "%s" | NIX says: %s = "%s"',
      coalesce(a.name, '?'), t.title,
      case s.field when 'featured_artists' then 'featuring' else s.field end, s.suggested)
  end
  from nix_suggestions s join tracks t on t.id = s.track_id left join artists a on a.id = t.artist_id
  where s.id = p_id;
$$;

-- What each kind of answer means, for Claude.
create or replace function public.sc_nix_check_rules(p_kind text)
returns text language sql stable security definer set search_path to 'public' as $$
  select case p_kind
    when 'audit' then 'VERSION AUDIT items: NIX says a song is NOT a version of the main song it is filed under and should be unlinked. A version is any take of the same composition: numbered versions ([V1], [V2]), demos, remixes, live recordings (often with a place or date), remasters, edits, radio/clean/explicit, instrumentals, sped up/slowed, snippets, OG files, sessions, a year or date in brackets, or an added subtitle. Agree only when they really are different songs: a "Pt. 2" sequel, a generic title (Intro, Outro, Skit, Interlude, Untitled) shared by unrelated tracks, or unrelated songs that only share a title. When you disagree the right answer is "keep linked".'
    when 'eras' then 'ERA items: NIX picked the era (album or period) of an unreleased song from the artist''s existing eras. Agree when the song''s notes, dates or title support that era. Disagree when they point to another era or nothing supports it; the right answer is the era you think fits, or "no era".'
    when 'notes' then 'FROM NOTES items: NIX filled an empty field from the song''s own notes. Agree only when the notes plainly state that value for this song (dates must be a full YYYY-MM-DD the notes give). Disagree when it is guessed, about another song, the wrong field, or badly formatted; the right answer is the correct value, or "nothing".'
    when 'titles' then 'TITLE items: NIX cleaned a title, or pulled producers or featured artists out of it. Agree when the new value is right: leftovers like [CDQ], [HQ], [OG], [Leak], (prod. X), (feat. X) and file extensions removed, real version names like (Remix), [V2], (Demo), (Live) kept. Otherwise the right answer is the correct value.'
    else upper(p_kind) || ' items (NIX had to pick one answer): ' || split_part(sc_nix_review_prompt(p_kind, '[{"line":"x"}]'::jsonb), E'\n\n', 1)
      || E'\nWhen you disagree the right answer is one of the words NIX could have picked.'
  end;
$$;

-- The next things to check: open suggestions first, then review notes.
create or replace function public.sc_nix_check_batch(p_secret text, p_limit int default 40)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare items jsonb := '[]'; got int; kinds text[]; rules text; lines text;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;

  with picked as (
    select id from nix_suggestions
    where state = 'open' and checked_at is null and (check_claim_at is null or check_claim_at < now() - interval '5 minutes')
    order by created_at, id limit greatest(1, least(p_limit, 60)) for update skip locked)
  update nix_suggestions s set check_claim_at = clock_timestamp() from picked where s.id = picked.id;

  select coalesce(jsonb_agg(jsonb_build_object('key', 's:' || s.id, 'kind', s.kind, 'line', sc_nix_check_line(s.id)) order by s.created_at, s.id), '[]')
  into items from nix_suggestions s
  where s.state = 'open' and s.checked_at is null and s.check_claim_at > now() - interval '1 minute' and s.check_claim_at >= now();
  got := jsonb_array_length(items);

  if got < p_limit then
    with picked as (
      select kind, item_key from nix_notes
      where kind in ('cleanup', 'mixups', 'deezer', 'duplicates') and line is not null and checked_at is null
        and (check_claim_at is null or check_claim_at < now() - interval '5 minutes')
      order by array_position(array['cleanup', 'mixups', 'deezer', 'duplicates'], kind), created_at
      limit p_limit - got for update skip locked)
    update nix_notes n set check_claim_at = clock_timestamp() from picked where n.kind = picked.kind and n.item_key = picked.item_key;

    select items || coalesce(jsonb_agg(jsonb_build_object('key', 'n:' || n.kind || ':' || n.item_key, 'kind', n.kind,
             'line', n.line || ' | NIX says: ' || n.verdict || coalesce(' (' || n.note || ')', '')) order by n.created_at), '[]')
    into items from nix_notes n
    where n.kind in ('cleanup', 'mixups', 'deezer', 'duplicates') and n.checked_at is null and n.check_claim_at >= now();
  end if;

  items := (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(items) x where x ->> 'line' is not null);
  if jsonb_array_length(items) = 0 then return null; end if;

  select array_agg(distinct x ->> 'kind') into kinds from jsonb_array_elements(items) x;
  select string_agg(sc_nix_check_rules(k), E'\n\n') into rules from unnest(kinds) k;
  select string_agg(o.n || '. [' || (o.x ->> 'kind') || '] ' || (o.x ->> 'line'), E'\n' order by o.n) into lines
  from jsonb_array_elements(items) with ordinality o(x, n);

  return jsonb_build_object(
    'keys', (select jsonb_agg(x -> 'key') from jsonb_array_elements(items) x),
    'prompt', 'You are checking the work of NIX, a small AI model that helps the admins of a fan music archive (released songs, leaks, snippets, unreleased eras). Each numbered item shows what NIX looked at and what NIX said. Judge from the information given plus well-known facts about music releases; when you cannot tell, say unsure rather than guess.'
      || E'\n\n' || rules || E'\n\n' || lines
      || E'\n\nReply with exactly one line per item and nothing else, in this form:\n1|agree\n2|disagree|<the right answer>|<why, under 15 words>\n3|unsure|<why, under 15 words>');
end $$;

-- Save Claude's answers; anything it skipped goes back in line.
create or replace function public.sc_nix_check_save(p_secret text, p_keys jsonb, p_items jsonb, p_model text)
returns int language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; k text; v text; n int := 0; kd text; ik text;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  for r in select value from jsonb_array_elements(coalesce(p_items, '[]')) loop
    k := p_keys ->> ((r ->> 'n')::int - 1);
    v := lower(r ->> 'v');
    continue when k is null or v not in ('agree', 'disagree', 'unsure');
    if k like 's:%' then
      update nix_suggestions set check_verdict = v, check_answer = left(nullif(r ->> 'answer', ''), 200), check_note = left(nullif(r ->> 'why', ''), 200),
        checked_at = now(), check_claim_at = null
      where id = substring(k from 3)::bigint;
    else
      kd := split_part(k, ':', 2);
      ik := substring(k from length(kd) + 4);
      update nix_notes set check_verdict = v, check_answer = left(nullif(r ->> 'answer', ''), 200), check_note = left(nullif(r ->> 'why', ''), 200),
        checked_at = now(), check_claim_at = null
      where kind = kd and item_key = ik;
    end if;
    n := n + 1;
  end loop;
  -- not answered: claims released
  update nix_suggestions set check_claim_at = null
  where checked_at is null and id in (select substring(x from 3)::bigint from jsonb_array_elements_text(p_keys) x where x like 's:%');
  update nix_notes nn set check_claim_at = null
  from (select split_part(x, ':', 2) kd, substring(x from length(split_part(x, ':', 2)) + 4) ik from jsonb_array_elements_text(p_keys) x where x like 'n:%') q
  where nn.checked_at is null and nn.kind = q.kd and nn.item_key = q.ik;
  return n;
end $$;

revoke all on function public.sc_nix_check_line(bigint), public.sc_nix_check_rules(text), public.sc_nix_check_batch(text, int),
  public.sc_nix_check_save(text, jsonb, jsonb, text) from public, anon, authenticated;

-- ------------------------------------------------------------- lessons
-- The owner's decisions first; then Claude's recent disagreements.
create or replace function public.sc_nix_lessons_text(p_kind text, p_n int default 8)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare v text; c text; outv text := '';
begin
  if p_kind in ('notes', 'eras', 'audit', 'titles') then
    select string_agg(format('- "%s" by %s | %s: %s -> the owner %s', t.title, coalesce(a.name, '?'), s.field,
             case when s.field = 'parent' then 'unlink from "' || coalesce(s.current_value, '?') || '"' else s.suggested end,
             case s.state when 'accepted' then 'ACCEPTED this' else 'REJECTED this' end), E'\n')
    into v from (
      select * from nix_suggestions where kind = p_kind and state in ('accepted', 'rejected') and decided_by is not null
      order by (state = 'rejected') desc, decided_at desc limit p_n) s
    join tracks t on t.id = s.track_id left join artists a on a.id = t.artist_id;
    select string_agg(format('- "%s" by %s | %s: %s -> WRONG, right answer: %s (%s)', t.title, coalesce(a.name, '?'), s.field,
             case when s.field = 'parent' then 'unlink from "' || coalesce(s.current_value, '?') || '"' else s.suggested end,
             coalesce(s.check_answer, '-'), coalesce(s.check_note, '-')), E'\n')
    into c from (
      select * from nix_suggestions where kind = p_kind and check_verdict = 'disagree' and decided_by is null
      order by checked_at desc limit 6) s
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
    select string_agg(format('- %s -> you said "%s"; the right answer is "%s" (%s)', n.line, n.verdict, coalesce(n.check_answer, '?'), coalesce(n.check_note, '-')), E'\n')
    into c from (
      select * from nix_notes where kind = p_kind and check_verdict = 'disagree' and line is not null
      order by checked_at desc limit 6) n;
  end if;
  if v is not null then
    outv := E'\n\nRecent decisions by the archive''s owner on cases like these (follow the same judgement):\n' || v;
  end if;
  if c is not null then
    outv := outv || E'\n\nRecent answers a careful checker found wrong (learn from them):\n' || c;
  end if;
  return outv;
end $$;

-- ------------------------------------------------------------- audit prompt
do $$
declare d text := pg_get_functiondef('public.sc_nix_suggest_batch'::regproc);
begin
  d := replace(d, '(numbered versions, demos, remixes, live, instrumentals, sped up/slowed, edits, snippets, OG/leak versions, freestyles of it).',
    '(numbered versions like [V1] or [V2], demos, remixes, live recordings (often with a place or date), remasters, edits, radio/clean versions, instrumentals, sped up/slowed, snippets, OG/leak versions, sessions, freestyles of it, a year or date in brackets, or an added subtitle). A different word or year after the title does NOT make it a different song.');
  if position('A different word or year after the title' in d) = 0 then raise exception 'audit prompt patch missed'; end if;
  execute d;
end $$;

-- ------------------------------------------------------------- review page
drop function if exists public.admin_nix_suggestions(text, int);
create or replace function public.admin_nix_suggestions(p_kind text, p_limit int default 200, p_pile text default null)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when is_moderator() then jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(kind, n), '{}') from (select kind, count(*) n from nix_suggestions where state = 'open' group by kind) c),
    'left', (select coalesce(jsonb_object_agg(kind, n), '{}') from (select kind, count(*) n from nix_work group by kind) w),
    'piles', (select jsonb_build_object(
        'agree', count(*) filter (where check_verdict = 'agree'),
        'disagree', count(*) filter (where check_verdict = 'disagree'),
        'unsure', count(*) filter (where check_verdict = 'unsure'),
        'unchecked', count(*) filter (where check_verdict is null))
      from nix_suggestions where kind = p_kind and state = 'open'),
    'items', (select coalesce(jsonb_agg(x), '[]') from (
      select jsonb_build_object('id', s.id, 'track_id', s.track_id, 'title', t.title, 'artist_id', t.artist_id, 'artist', a.name,
        'status', t.release_status, 'field', s.field, 'current', s.current_value, 'suggested', s.suggested, 'note', s.note, 'model', s.model,
        'sure', s.confidence, 'check', s.check_verdict, 'check_answer', s.check_answer, 'check_note', s.check_note) x
      from nix_suggestions s join tracks t on t.id = s.track_id left join artists a on a.id = t.artist_id
      where s.kind = p_kind and s.state = 'open'
        and (p_pile is null or (p_pile = 'unchecked' and s.check_verdict is null) or s.check_verdict = p_pile)
      order by case s.confidence when 'high' then 0 when 'medium' then 1 when 'low' then 3 else 2 end, a.name, t.title, s.field
      limit greatest(1, least(coalesce(p_limit, 200), 1000))) q))
  end;
$$;
revoke all on function public.admin_nix_suggestions(text, int, text) from public, anon;
grant execute on function public.admin_nix_suggestions(text, int, text) to authenticated;

create or replace function public.admin_nix_notes(p_kind text, p_keys text[])
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when is_moderator() then coalesce((select jsonb_object_agg(item_key, jsonb_build_object('verdict', verdict, 'note', note, 'model', model,
      'check', check_verdict, 'check_answer', check_answer, 'check_note', check_note))
    from nix_notes where kind = p_kind and item_key = any (p_keys[1:500])), '{}') end;
$$;

-- ------------------------------------------------------------- /nix score
do $$
declare d text := pg_get_functiondef('public.admin_nix_jobs_progress'::regproc);
begin
  d := replace(d, '''suggested'', (select count(*) from nix_suggestions s where s.kind = k.kind and s.state = ''open''),',
    '''suggested'', (select count(*) from nix_suggestions s where s.kind = k.kind and s.state = ''open''),
      ''checked'', case when k.src = ''suggest'' then (select count(*) from nix_suggestions s where s.kind = k.kind and s.check_verdict is not null)
        else (select count(*) from nix_notes n where n.kind = k.kind and n.check_verdict is not null) end,
      ''claude_agreed'', case when k.src = ''suggest'' then (select count(*) from nix_suggestions s where s.kind = k.kind and s.check_verdict = ''agree'')
        else (select count(*) from nix_notes n where n.kind = k.kind and n.check_verdict = ''agree'') end,
      ''claude_disagreed'', case when k.src = ''suggest'' then (select count(*) from nix_suggestions s where s.kind = k.kind and s.check_verdict = ''disagree'')
        else (select count(*) from nix_notes n where n.kind = k.kind and n.check_verdict = ''disagree'') end,
      ''to_check'', case when k.src = ''suggest'' then (select count(*) from nix_suggestions s where s.kind = k.kind and s.state = ''open'' and s.checked_at is null)
        else (select count(*) from nix_notes n where n.kind = k.kind and n.line is not null and n.checked_at is null) end,');
  if position('claude_agreed' in d) = 0 then raise exception 'progress patch missed'; end if;
  execute d;
end $$;

-- ------------------------------------------------------------- the job
insert into public.nix_tasks (name, fn, body, every, max_every, only_if) values
  ('nix-check', 'nix-check', '{}', '2 min', '20 min',
   'exists (select 1 from public.nix_suggestions where state = ''open'' and checked_at is null) or exists (select 1 from public.nix_notes where line is not null and checked_at is null and kind in (''cleanup'', ''mixups'', ''deezer'', ''duplicates''))')
on conflict (name) do nothing;

-- ------------------------------------------------------------- tuning after the first runs
-- Titles: judge the one value NIX gave (each field is its own item).
-- Eras: show which other eras share the song's year, so a date inside one
-- era's years (and no other's) is enough to agree.
create or replace function public.sc_nix_check_rules(p_kind text)
returns text language sql stable security definer set search_path to 'public' as $$
  select case p_kind
    when 'audit' then 'VERSION AUDIT items: NIX says a song is NOT a version of the main song it is filed under and should be unlinked. A version is any take of the same composition: numbered versions ([V1], [V2]), demos, remixes, live recordings (often with a place or date), remasters, edits, radio/clean/explicit, instrumentals, sped up/slowed, snippets, OG files, sessions, a year or date in brackets, or an added subtitle. Agree only when they really are different songs: a "Pt. 2" sequel, a generic title (Intro, Outro, Skit, Interlude, Untitled) shared by unrelated tracks, or unrelated songs that only share a title. When you disagree the right answer is "keep linked".'
    when 'eras' then 'ERA items: NIX picked the era (album or period) of an unreleased song from the artist''s existing eras. In brackets you see the years that era''s songs date from, and which other eras have songs from the same year as this song. Agree when the notes or title name that era, or when the song''s date falls inside that era''s years and no other era shares that year. Disagree when the notes, title or date point to another era; the right answer is that era, or "no era". Say unsure when other eras share the year and nothing else decides it.'
    when 'notes' then 'FROM NOTES items: NIX filled an empty field from the song''s own notes. Agree only when the notes plainly state that value for this song (dates must be a full YYYY-MM-DD the notes give). Disagree when it is guessed, about another song, the wrong field, or badly formatted; the right answer is the correct value, or "nothing".'
    when 'titles' then 'TITLE items: NIX cleaned a title, or pulled producers or featured artists out of it. Each field is a separate item: judge ONLY the one value NIX gave on that line, and agree when that value is right even if another field could be improved. A clean title has leftovers like [CDQ], [HQ], [OG], [Leak], [Snippet], (prod. X), (feat. X), ft. X, file extensions, @handles and hashtags removed, and keeps real parts of the name and real version names like (Remix), [V2], (Demo), (Live). Producers come from "prod." credits, featured artists from "feat."/"ft." credits. When you disagree, the right answer is just the correct value for that field.'
    else upper(p_kind) || ' items (NIX had to pick one answer): ' || split_part(sc_nix_review_prompt(p_kind, '[{"line":"x"}]'::jsonb), E'\n\n', 1)
      || E'\nWhen you disagree the right answer is one of the words NIX could have picked.'
  end;
$$;

create or replace function public.sc_nix_check_line(p_id bigint)
returns text language sql stable security definer set search_path to 'public' as $$
  select case s.kind
    when 'audit' then format('artist: %s | song: "%s" (%s) | filed as a version of: "%s" | NIX says: NOT a version of it, unlink. Why: %s',
      coalesce(a.name, '?'), t.title, coalesce(t.release_status, '?'), coalesce(s.current_value, '?'), coalesce(s.note, '-'))
    when 'eras' then format('artist: %s | song: "%s" (%s)%s%s%s | NIX says: era "%s"%s. Why: %s',
      coalesce(a.name, '?'), t.title, coalesce(t.release_status, '?'),
      case when t.leak_date is not null then ' | leaked ' || t.leak_date end,
      case when t.release_date is not null then ' | dated ' || t.release_date end,
      case when nullif(t.notes, '') is not null then ' | notes: "' || left(regexp_replace(t.notes, '\s+', ' ', 'g'), 300) || '"' else '' end,
      s.suggested,
      (select ' (its songs date ' || coalesce(min(extract(year from coalesce(x.release_date, x.leak_date)))::int::text, '?')
              || case when max(extract(year from coalesce(x.release_date, x.leak_date))) > min(extract(year from coalesce(x.release_date, x.leak_date)))
                      then '-' || max(extract(year from coalesce(x.release_date, x.leak_date)))::int else '' end
              || case when coalesce(t.release_date, t.leak_date) is null then '' else '; other eras with songs from '
                   || extract(year from coalesce(t.release_date, t.leak_date))::int || ': '
                   || coalesce((select string_agg(distinct '"' || y.album || '"', ', ')
                                from tracks y where y.artist_id = t.artist_id and y.album is not null and y.album <> s.suggested
                                  and extract(year from coalesce(y.release_date, y.leak_date)) = extract(year from coalesce(t.release_date, t.leak_date))), 'none') end
              || ')'
       from tracks x where x.artist_id = t.artist_id and x.album = s.suggested),
      coalesce(s.note, '-'))
    when 'notes' then format('artist: %s | song: "%s" | notes: "%s" | NIX says: %s = "%s". Why: %s',
      coalesce(a.name, '?'), t.title, left(regexp_replace(coalesce(t.notes, ''), '\s+', ' ', 'g'), 600),
      case s.field when 'leak_date' then 'leak date' when 'featured_artists' then 'featuring' when 'aliases' then 'other names' else s.field end,
      s.suggested, coalesce(s.note, '-'))
    else format('artist: %s | title now: "%s" | NIX says: %s = "%s"',
      coalesce(a.name, '?'), t.title,
      case s.field when 'featured_artists' then 'featuring' else s.field end, s.suggested)
  end
  from nix_suggestions s join tracks t on t.id = s.track_id left join artists a on a.id = t.artist_id
  where s.id = p_id;
$$;
revoke all on function public.sc_nix_check_line(bigint), public.sc_nix_check_rules(text) from public, anon, authenticated;

-- One kind per batch, so the edge function can let Claude think a little on
-- the harder kinds (eras, reading notes) and answer straight off on the rest.
-- A "disagree" whose right answer is what NIX already said counts as agree.
create or replace function public.sc_nix_check_batch(p_secret text, p_limit int default 40)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare items jsonb := '[]'; v_kind text; v_n int; rules text; lines text; think boolean;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;

  select kind into v_kind from nix_suggestions
  where state = 'open' and checked_at is null and (check_claim_at is null or check_claim_at < now() - interval '5 minutes')
  order by created_at, id limit 1;

  if v_kind is not null then
    v_n := case when v_kind in ('eras', 'notes') then least(p_limit, 20) else least(p_limit, 40) end;
    with picked as (
      select id from nix_suggestions
      where kind = v_kind and state = 'open' and checked_at is null and (check_claim_at is null or check_claim_at < now() - interval '5 minutes')
      order by created_at, id limit v_n for update skip locked)
    update nix_suggestions s set check_claim_at = clock_timestamp() from picked where s.id = picked.id;
    select coalesce(jsonb_agg(jsonb_build_object('key', 's:' || s.id, 'line', sc_nix_check_line(s.id)) order by s.created_at, s.id), '[]')
    into items from nix_suggestions s
    where s.kind = v_kind and s.state = 'open' and s.checked_at is null and s.check_claim_at >= now();
  else
    select kind into v_kind from nix_notes
    where kind in ('cleanup', 'mixups', 'deezer', 'duplicates') and line is not null and checked_at is null
      and (check_claim_at is null or check_claim_at < now() - interval '5 minutes')
    order by array_position(array['cleanup', 'mixups', 'deezer', 'duplicates'], kind), created_at limit 1;
    if v_kind is null then return null; end if;
    v_n := case when v_kind in ('mixups', 'deezer') then least(p_limit, 15) else least(p_limit, 40) end;
    with picked as (
      select kind, item_key from nix_notes
      where kind = v_kind and line is not null and checked_at is null
        and (check_claim_at is null or check_claim_at < now() - interval '5 minutes')
      order by created_at limit v_n for update skip locked)
    update nix_notes n set check_claim_at = clock_timestamp() from picked where n.kind = picked.kind and n.item_key = picked.item_key;
    select coalesce(jsonb_agg(jsonb_build_object('key', 'n:' || n.kind || ':' || n.item_key,
             'line', n.line || ' | NIX says: ' || n.verdict || coalesce(' (' || n.note || ')', '')) order by n.created_at), '[]')
    into items from nix_notes n
    where n.kind = v_kind and n.checked_at is null and n.check_claim_at >= now();
  end if;

  items := (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(items) x where x ->> 'line' is not null);
  if jsonb_array_length(items) = 0 then return null; end if;
  think := v_kind in ('eras', 'notes', 'mixups', 'deezer');
  rules := sc_nix_check_rules(v_kind);
  select string_agg(o.n || '. ' || (o.x ->> 'line'), E'\n' order by o.n) into lines
  from jsonb_array_elements(items) with ordinality o(x, n);

  return jsonb_build_object(
    'kind', v_kind, 'think', think,
    'keys', (select jsonb_agg(x -> 'key') from jsonb_array_elements(items) x),
    'prompt', 'You are checking the work of NIX, a small AI model that helps the admins of a fan music archive (released songs, leaks, snippets, unreleased eras). Each numbered item shows what NIX looked at and what NIX said. Judge from the information given plus well-known facts about music releases; when you cannot tell, say unsure rather than guess. If NIX''s answer is right, say agree: never disagree and then give NIX''s own answer as the right one.'
      || E'\n\n' || rules || E'\n\n' || lines
      || E'\n\nReply with exactly one line per item and nothing else, in this form:\n1|agree\n2|disagree|<the right answer>|<why, under 15 words>\n3|unsure|<why, under 15 words>');
end $$;

create or replace function public.sc_nix_same_answer(a text, b text)
returns boolean language sql immutable as $$
  select nullif(lower(btrim(regexp_replace(coalesce(a, ''), '^\s*(title|producers|featuring|era|value)\s*[=:]\s*', '', 'i'), ' "''')), '')
       = lower(btrim(coalesce(b, ''), ' "'''));
$$;

create or replace function public.sc_nix_check_save(p_secret text, p_keys jsonb, p_items jsonb, p_model text)
returns int language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; k text; v text; n int := 0; kd text; ik text; ans text;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  for r in select value from jsonb_array_elements(coalesce(p_items, '[]')) loop
    k := p_keys ->> ((r ->> 'n')::int - 1);
    v := lower(r ->> 'v');
    ans := left(nullif(r ->> 'answer', ''), 200);
    continue when k is null or v not in ('agree', 'disagree', 'unsure');
    if k like 's:%' then
      if v = 'disagree' and (sc_nix_same_answer(ans, (select suggested from nix_suggestions where id = substring(k from 3)::bigint))
                             or lower(coalesce(ans, '')) ~ '^\s*(no change|correct|nix is right)') then
        v := 'agree'; ans := null;
      end if;
      update nix_suggestions set check_verdict = v, check_answer = ans, check_note = left(nullif(r ->> 'why', ''), 200),
        checked_at = now(), check_claim_at = null
      where id = substring(k from 3)::bigint;
    else
      kd := split_part(k, ':', 2);
      ik := substring(k from length(kd) + 4);
      if v = 'disagree' and sc_nix_same_answer(ans, (select verdict from nix_notes where kind = kd and item_key = ik)) then
        v := 'agree'; ans := null;
      end if;
      update nix_notes set check_verdict = v, check_answer = ans, check_note = left(nullif(r ->> 'why', ''), 200),
        checked_at = now(), check_claim_at = null
      where kind = kd and item_key = ik;
    end if;
    n := n + 1;
  end loop;
  update nix_suggestions set check_claim_at = null
  where checked_at is null and id in (select substring(x from 3)::bigint from jsonb_array_elements_text(p_keys) x where x like 's:%');
  update nix_notes nn set check_claim_at = null
  from (select split_part(x, ':', 2) kd, substring(x from length(split_part(x, ':', 2)) + 4) ik from jsonb_array_elements_text(p_keys) x where x like 'n:%') q
  where nn.checked_at is null and nn.kind = q.kd and nn.item_key = q.ik;
  return n;
end $$;
revoke all on function public.sc_nix_check_batch(text, int), public.sc_nix_check_save(text, jsonb, jsonb, text) from public, anon, authenticated;

-- First runs had no thinking on eras: check those again.
update public.nix_suggestions set check_verdict = null, check_answer = null, check_note = null, checked_at = null, check_claim_at = null
where kind in ('eras', 'notes') and checked_at is not null;
update public.nix_suggestions set check_verdict = 'agree', check_answer = null
where check_verdict = 'disagree' and sc_nix_same_answer(check_answer, suggested);
