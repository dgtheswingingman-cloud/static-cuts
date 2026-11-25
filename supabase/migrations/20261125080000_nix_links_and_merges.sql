-- Nathan, 25 Nov ("all 3"), after checking samples of each:
-- (a) Found links where NIX and Claude (or the final say) both say "right
--     link", the song has no listen link yet, and the link's title ends with
--     the song's exact title (brackets, "ft." and "prod." ignored; generic
--     titles like Intro left out) go on their songs. One undo batch.
-- (b) Duplicate groups on ONE artist's page that NIX and Claude both call
--     the same song are merged, keeping the copy with the most known about
--     it. One undo batch.

do $$
declare n int;
begin
  perform set_config('static_cuts.batch_id', '', true);
  create temp table _links on commit drop as
  with x as (
    select c.id, c.track_id, c.url, c.album, c.release_date, c.suggested_status, c.found_at,
      case when n.final_side in ('checker', 'neither') then n.final_answer when n.final_side = 'nix' or n.check_verdict = 'agree' then n.verdict else 'unsure' end settled,
      btrim(regexp_replace(regexp_replace(lower(coalesce(c.title, '')), '\s*(\(|\[|\{)[^)\]\}]*(\)|\]|\})', '', 'g'), '\s+(ft\.?|feat\.?|prod\.?)\s.*$|\s*\|.*$', '', 'g')) lt_n,
      btrim(regexp_replace(lower(t.title), '\s*(\(|\[|\{)[^)\]\}]*(\)|\]|\})', '', 'g')) t_n
    from track_link_candidates c join tracks t on t.id = c.track_id
    join nix_notes n on n.kind = 'links' and n.item_key = c.id::text
    where t.spotify_url is null)
  select distinct on (track_id) * from x
  where settled = 'match' and length(t_n) >= 3 and t_n !~ '^(intro|outro|interlude|skit|untitled|unknown|\?+)\b'
    and (lt_n = t_n or right(lt_n, length(t_n) + 3) in (' - ' || t_n, ' – ' || t_n) or right(lt_n, length(t_n) + 1) = '-' || t_n)
  order by track_id, found_at desc nulls last;
  select count(*) into n from _links;
  perform sc_begin_batch('links', 'Found links NIX and Claude agreed on: ' || n || ' songs');
  update tracks t set
    spotify_url = l.url,
    album = coalesce(t.album, l.album),
    release_date = coalesce(t.release_date, l.release_date),
    release_status = case when coalesce(t.release_status, 'unconfirmed') = 'unconfirmed' and l.suggested_status is not null
                          then l.suggested_status else t.release_status end
  from _links l where t.id = l.track_id and t.spotify_url is null;
  delete from track_link_candidates c using _links l where c.id = l.id;
  raise notice 'links: %', n;
end $$;

do $$
declare g record; keep text; dups text[]; n int := 0;
begin
  perform set_config('static_cuts.batch_id', '', true);
  perform set_config('static_cuts.system_job', 'version-auto-clear', true);
  perform sc_begin_batch('merge', 'Duplicates NIX and Claude agreed on (same artist)');
  for g in
    select d.group_id, d.ids from nix_notes nn join duplicate_candidates d on d.group_id = nn.item_key
    where nn.kind = 'duplicates' and nn.verdict = 'same' and (nn.check_verdict = 'agree' or nn.final_side = 'nix')
      and cardinality(d.ids) > 1 and cardinality(d.artists) = 1
      and not exists (select 1 from duplicate_dismissals dd where dd.group_id = d.group_id)
  loop
    select t.id into keep from tracks t where t.id = any (g.ids)
    order by release_status_rank(t.release_status) desc, (t.spotify_url is not null) desc, (t.album is not null) desc,
             (t.length_sec is not null) desc, length(coalesce(t.notes, '')) desc, t.id
    limit 1;
    continue when keep is null;
    select array_agg(t.id) into dups from tracks t where t.id = any (g.ids) and t.id <> keep;
    continue when dups is null;
    perform admin_merge_duplicates(keep, dups);
    n := n + 1;
  end loop;
  perform set_config('static_cuts.system_job', '', true);
  raise notice 'merged groups: %', n;
end $$;

-- (c) Duplicates across artists: NIX and Claude kept calling same-title songs
-- by different artists "the same" (Holla by Busta Rhymes / JAY-Z, Lullaby in
-- Rhythm by Chet Baker / Peggy Lee). The rules (NIX's prompt, which Claude's
-- check reads too) now say different artists mean different songs unless the
-- line shows the same recording, and those groups are answered again.
do $$
declare d text := pg_get_functiondef('public.sc_nix_review_prompt(text, jsonb)'::regprocedure);
begin
  d := replace(d, 'Say "unsure" when you can''''t tell.'';
    opts := ''same|different|unsure'';',
'Different artists: songs by DIFFERENT artists sharing a title are almost always DIFFERENT songs (covers, standards, common titles like "Holla" or "Jump for Joy"). Only say "same" across artists when the line shows it is the same recording: the same album AND date or length, one artist featured on the other''''s song, or two spellings of the same act (JAY-Z and JAŸ-Z, an "archive" page of the same artist).
A length missing on one side is not evidence either way; a known length more than about 10 seconds apart always means different.
Say "unsure" when you can''''t tell.'';
    opts := ''same|different|unsure'';');
  if position('Different artists: songs by DIFFERENT artists' in d) = 0 then raise exception 'patch missed'; end if;
  execute d;
end $$;

delete from public.nix_notes n using public.duplicate_candidates d
where n.kind = 'duplicates' and n.item_key = d.group_id and n.verdict = 'same' and cardinality(d.artists) > 1;
