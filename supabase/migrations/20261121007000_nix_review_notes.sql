-- NIX helps with the review lists (only while a PC is running NIX: free).
--
-- For Duplicates, Clean-up (not a song / placeholder), Bio mix-ups and
-- Deezer check, NIX reads each item and leaves a note: its verdict and a short
-- reason. Nothing is applied: the notes show on each review page to make
-- deciding quicker. Work goes out in small batches (one per list at a time),
-- in the same order the pages show items, so the top of each list is done first.
--
-- nix_notes       one note per item (kind + item key)
-- sc_nix_review   the NIX job (every minute while a PC is online): saves
--                 finished answers, then queues the next batch per list
-- admin_nix_notes the notes for a page (moderators and up)

create table if not exists public.nix_notes (
  kind text not null,          -- duplicates | cleanup | mixups | deezer
  item_key text not null,
  verdict text,
  note text,
  model text,
  created_at timestamptz not null default now(),
  primary key (kind, item_key)
);
alter table public.nix_notes enable row level security;

create or replace function public.sc_mmss(s int)
returns text language sql immutable as $$
  select case when s is null or s <= 0 then '?' else (s / 60)::text || ':' || lpad((s % 60)::text, 2, '0') end;
$$;

-- The next items for a list that have no note yet: [{key, line}].
create or replace function public.sc_nix_review_items(p_kind text, p_limit int)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if p_kind = 'duplicates' then
    select coalesce(jsonb_agg(jsonb_build_object('key', g.group_id, 'line', g.line) order by g.score desc, g.key), '[]') into v from (
      select d.group_id, d.key,
        (case when cardinality(d.artists) = 1 then 500 else 0 end) + least(d.strength, 100) score,
        (select string_agg(format('"%s" by %s (%s%s, %s%s)', t.title, coalesce(a.name, '?'), t.release_status,
            case when nullif(t.album, '') is not null then ', album "' || t.album || '"' else '' end,
            sc_mmss(t.length_sec),
            case when t.release_date is not null then ', ' || t.release_date::text else '' end), ' ; ' order by t.id)
         from (select * from tracks t where t.id = any (d.ids) order by t.id limit 4) t left join artists a on a.id = t.artist_id) line
      from duplicate_candidates d
      where cardinality(d.ids) > 1
        and not exists (select 1 from duplicate_dismissals dd where dd.group_id = d.group_id)
        and not exists (select 1 from nix_notes n where n.kind = 'duplicates' and n.item_key = d.group_id)
      order by (case when cardinality(d.artists) = 1 then 500 else 0 end) + least(d.strength, 100) desc, d.key
      limit p_limit) g
    where g.line is not null;
  elsif p_kind = 'cleanup' then
    select coalesce(jsonb_agg(jsonb_build_object('key', x.id, 'line', x.line) order by x.artist, x.title), '[]') into v from (
      select t.id, a.name artist, t.title,
        format('artist: %s | title: "%s" | flagged as: %s | status: %s%s', a.name, t.title,
          case sc_cleanup_kind(t.title) when 'not_song' then 'not a song' else 'placeholder' end, t.release_status,
          case when nullif(t.album, '') is not null then ' | album: "' || t.album || '"' else '' end) line
      from tracks t join artists a on a.id = t.artist_id
      where t.parent_track_id is null and sc_cleanup_kind(t.title) is not null
        and not exists (select 1 from cleanup_kept k where k.track_id = t.id)
        and not exists (select 1 from nix_notes n where n.kind = 'cleanup' and n.item_key = t.id)
      order by a.name, t.title
      limit p_limit) x;
  elsif p_kind = 'mixups' then
    select coalesce(jsonb_agg(jsonb_build_object('key', x.id, 'line', x.line)), '[]') into v from (
      select f.id::text id,
        format('artist page: %s | flagged because the bio %s%s | bio excerpt: "%s"', a.name,
          case f.kind when 'alias' then 'mentions another name' else 'seems to describe more than one act' end,
          case when o.name is not null then ' (' || o.name || ')' else '' end, left(f.excerpt, 600)) line
      from artist_mixup_flags f join artists a on a.id = f.artist_id left join artists o on o.id = f.other_artist_id
      where f.state = 'open' and not exists (select 1 from nix_notes n where n.kind = 'mixups' and n.item_key = f.id::text)
      order by a.name limit p_limit) x;
  elsif p_kind = 'deezer' then
    select coalesce(jsonb_agg(jsonb_build_object('key', x.id, 'line', x.line)), '[]') into v from (
      select a.id,
        format('artist: %s | songs on the archive: %s | releases on the Deezer page matched to it: %s', a.name,
          (select string_agg(s, ', ') from (select distinct coalesce(t.album, t.title) s from tracks t
             where t.artist_id = a.id and coalesce(t.source, '') <> 'deezer' and coalesce(t.album, t.title) is not null limit 10) q),
          (select string_agg(r, ', ') from (select d.title || coalesce(' (' || extract(year from d.release_date)::int || ')', '') r
             from deezer_albums d where d.artist_id = a.id order by d.release_date nulls last limit 14) q)) line
      from artists a
      where ((a.deezer_suspect and a.deezer_check is null)
          or (a.deezer_check = 'mixed' and exists (select 1 from deezer_albums d where d.artist_id = a.id and d.review is null)))
        and not exists (select 1 from nix_notes n where n.kind = 'deezer' and n.item_key = a.id)
      order by a.deezer_check = 'mixed' desc, a.deezer_matched::numeric / greatest(a.deezer_releases, 1), a.deezer_releases desc
      limit p_limit) x
    where x.line is not null;
  end if;
  return coalesce(v, '[]');
end $$;

create or replace function public.sc_nix_review_prompt(p_kind text, p_items jsonb)
returns text language plpgsql immutable as $$
declare head text; opts text; lines text;
begin
  select string_agg((o.n)::text || '. ' || (o.x ->> 'line'), E'\n' order by o.n) into lines
  from jsonb_array_elements(p_items) with ordinality o(x, n);
  if p_kind = 'duplicates' then
    head := 'You help the admins of a fan music archive (released songs, leaks, snippets). Each group below lists songs that might be the same song filed more than once.
Say "same" when they are the same song: the same title apart from formatting, spelling, a feat. credit or brackets, AND nothing says otherwise (lengths within about 5 seconds, or the same album or date, or details missing).
Say "different" when they are different songs or versions: lengths more than about 10 seconds apart, a version tag on one but not the other (Remix, Live, V2, Demo, Instrumental, Sped Up, Slowed, Acoustic, Snippet), "Pt. 2", or unrelated songs that only share a common title.
Say "unsure" when you can''t tell.';
    opts := 'same|different|unsure';
  elsif p_kind = 'cleanup' then
    head := 'You help the admins of a fan music archive. These entries were flagged by a word in their title. Decide what each one really is.
"not_song": not a piece of music (an interview, livestream, documentary, trailer, a full-album upload, a tracklist, cover art, a playlist, a notice).
"placeholder": a stand-in with nothing known ("Untitled", "Unknown", "???", "TBA") that only marks a gap.
"real_song": a real song whose title happens to contain the word (e.g. a song called "Interview" or "Untitled 3" that is a known track).
"unsure": can''t tell.';
    opts := 'not_song|placeholder|real_song|unsure';
  elsif p_kind = 'mixups' then
    head := 'You help the admins of a fan music archive. These artist bios were flagged as possibly describing someone else. Read each excerpt.
"mixup": the bio is about a different person or act than the artist page it''s on (a namesake).
"fine": the bio is about this artist; mentioning another name is normal (an alias, a former name, a group they were in, a collaborator).
"unsure": can''t tell.';
    opts := 'mixup|fine|unsure';
  else
    head := 'You help the admins of a fan music archive. Each artist below was matched to a Deezer page, but the match looks doubtful. Compare the songs on the archive with the releases on that Deezer page.
"same": the Deezer page is this artist.
"different": a different act with the same name.
"mixed": the Deezer page has releases from this artist and from another act.
"unsure": can''t tell (for example too few songs to compare).';
    opts := 'same|different|mixed|unsure';
  end if;
  return head || E'\n\n' || lines || E'\n\nReply with JSON only: {"r":[{"n":1,"v":"' || opts || '","why":"under 15 words"}, ...]} covering every number.';
end $$;

-- The NIX job: save finished answers, then queue the next batch per list.
create or replace function public.sc_nix_review()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare j record; ans jsonb; r jsonb; k text; saved int := 0; queued int := 0; items jsonb; size int;
begin
  -- 1. Answers back from the PC.
  for j in
    update nix_ai_jobs set status = 'collected'
    where id in (select id from nix_ai_jobs where kind like 'review:%' and status in ('done', 'failed') order by id limit 20 for update skip locked)
    returning kind, payload, output, error, model
  loop
    continue when j.error is not null or j.output is null;
    begin ans := substring(j.output from '\{.*\}')::jsonb; exception when others then continue; end;
    for r in select value from jsonb_array_elements(coalesce(ans -> 'r', '[]')) loop
      begin
        k := j.payload -> 'keys' ->> ((r ->> 'n')::int - 1);
      exception when others then k := null; end;
      continue when k is null;
      insert into nix_notes (kind, item_key, verdict, note, model)
      values (substring(j.kind from 8), k, left(lower(r ->> 'v'), 20), left(r ->> 'why', 200), j.model)
      on conflict (kind, item_key) do update set verdict = excluded.verdict, note = excluded.note, model = excluded.model, created_at = now();
      saved := saved + 1;
    end loop;
  end loop;

  -- 2. More work, one batch per list at a time, only while a PC is online.
  if sc_nix_ai_online() then
    foreach k in array array['duplicates', 'cleanup', 'mixups', 'deezer'] loop
      continue when exists (select 1 from nix_ai_jobs where kind = 'review:' || k and status in ('queued', 'running'));
      size := case k when 'duplicates' then 20 when 'cleanup' then 30 when 'mixups' then 8 else 6 end;
      items := sc_nix_review_items(k, size);
      continue when jsonb_array_length(items) = 0;
      insert into nix_ai_jobs (kind, prompt, payload, json_reply)
      values ('review:' || k, sc_nix_review_prompt(k, items),
              jsonb_build_object('keys', (select jsonb_agg(x -> 'key') from jsonb_array_elements(items) x)), true);
      queued := queued + 1;
    end loop;
  end if;
  return jsonb_build_object('saved', saved, 'queued', queued);
end $$;

revoke all on function public.sc_nix_review_items(text, int), public.sc_nix_review(), public.sc_mmss(int)
  from public, anon, authenticated;

insert into public.nix_tasks (name, steps, every, max_every, only_if) values
  ('nix-review', '[{"name":"notes","sql":"public.sc_nix_review()"}]', '1 min', '1 min',
   'public.sc_nix_ai_online() or exists (select 1 from public.nix_ai_jobs where kind like ''review:%'' and status in (''done'', ''failed''))')
on conflict (name) do nothing;

-- For the review pages: notes for the items on screen.
create or replace function public.admin_nix_notes(p_kind text, p_keys text[])
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when is_moderator() then coalesce((select jsonb_object_agg(item_key, jsonb_build_object('verdict', verdict, 'note', note, 'model', model))
    from nix_notes where kind = p_kind and item_key = any (p_keys[1:500])), '{}') end;
$$;
revoke all on function public.admin_nix_notes(text, text[]) from public, anon;
grant execute on function public.admin_nix_notes(text, text[]) to authenticated;

-- For the NIX page: how far through each list it is.
create or replace function public.admin_nix_review_progress()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when is_admin() then (select coalesce(jsonb_object_agg(kind, n), '{}') from (select kind, count(*) n from nix_notes group by kind) s) end;
$$;
revoke all on function public.admin_nix_review_progress() from public, anon;
grant execute on function public.admin_nix_review_progress() to authenticated;
