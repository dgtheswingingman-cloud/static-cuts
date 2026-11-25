-- Nathan, 25 Nov: "Yes" to putting found links NIX and Claude agree on onto
-- their songs every day, with the same strict rules as the first batch
-- (20261125080000): both say "right link" (or the final say does), the song
-- has no listen link yet, the link's title ends with the song's exact title
-- (brackets, "ft." and "prod." ignored), generic titles like Intro left out.
-- Each day's links are one undo batch on /control (nothing made on quiet days).

create or replace function public.sc_apply_agreed_links() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
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
  if n = 0 then drop table _links; return 0; end if;
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('links', 'Found links NIX and Claude agreed on (' || to_char(now(), 'DD Mon') || '): ' || n || ' songs');
  update tracks t set
    spotify_url = l.url,
    album = coalesce(t.album, l.album),
    release_date = coalesce(t.release_date, l.release_date),
    release_status = case when coalesce(t.release_status, 'unconfirmed') = 'unconfirmed' and l.suggested_status is not null
                          then l.suggested_status else t.release_status end
  from _links l where t.id = l.track_id and t.spotify_url is null;
  delete from track_link_candidates c using _links l where c.id = l.id;
  perform set_config('static_cuts.batch_id', '', true);
  drop table _links;
  return n;
end $$;
revoke all on function public.sc_apply_agreed_links() from public, anon, authenticated;

insert into public.nix_tasks (name, every, max_every, at_time, next_at, enabled, steps)
values ('agreed-links', '1 day', '1 day', '05:23:00', (current_date + 1) + time '05:23', true,
        '[{"name":"linked","sql":"public.sc_apply_agreed_links()"}]')
on conflict (name) do update set steps = excluded.steps, at_time = excluded.at_time, enabled = true;
