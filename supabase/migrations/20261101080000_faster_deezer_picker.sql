-- Deezer was doing ~25 releases a minute: picking the next release took
-- ~300 ms each time (it ranked all 47,000 waiting releases). Now it picks the
-- artist first (931 rows), then their next release. The artist ranking
-- (follows + requests) is also worked out in one pass instead of two lookups
-- per artist; every background job that ranks artists uses it.

create or replace function sc_artist_weights()
returns table(artist_id text, weight integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.id, coalesce(10 * f.n, 0) + coalesce(3 * r.n, 0)
  from artists a
  left join (select f.artist_id, count(*)::int n from follows f group by 1) f on f.artist_id = a.id
  left join (select r.artist_id, count(*)::int n from artist_requests r
             where r.created_at > now() - interval '30 days' group by 1) r on r.artist_id = a.id;
$$;

do $$
declare
  d text := pg_get_functiondef('public.sc_deezer_next(text)'::regprocedure);
  old_block text := $o$  select d.artist_id, d.album_id into v_artist, v_album
  from deezer_albums d join artists a on a.id = d.artist_id
  left join sc_artist_weights() w on w.artist_id = d.artist_id
  where d.fetched_at is null and a.deezer_list_index is null
    and (d.claimed_at is null or d.claimed_at < now() - interval '2 minutes')
  order by coalesce(w.weight, 0) desc, d.artist_id,
           case d.kind when 'album' then 0 when 'ep' then 1 else 2 end, d.release_date nulls last, d.album_id
  limit 1
  for update of d skip locked;$o$;
  new_block text := $n$  select a.id into v_artist
  from artists a left join sc_artist_weights() w on w.artist_id = a.id
  where a.deezer_list_index is null
    and exists (select 1 from deezer_albums d where d.artist_id = a.id and d.fetched_at is null
                and (d.claimed_at is null or d.claimed_at < now() - interval '2 minutes'))
  order by coalesce(w.weight, 0) desc, a.id
  limit 1;
  if v_artist is not null then
    select d.album_id into v_album
    from deezer_albums d
    where d.artist_id = v_artist and d.fetched_at is null
      and (d.claimed_at is null or d.claimed_at < now() - interval '2 minutes')
    order by case d.kind when 'album' then 0 when 'ep' then 1 else 2 end, d.release_date nulls last, d.album_id
    limit 1
    for update of d skip locked;
  end if;$n$;
begin
  d := replace(d, E'\r\n', E'\n');
  if position(old_block in d) = 0 then
    if position('select a.id into v_artist' || E'\n' || '  from artists a left join sc_artist_weights()' in d) > 0 then return; end if;
    raise exception 'could not update sc_deezer_next';
  end if;
  execute replace(d, old_block, new_block);
end $$;
