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

-- The whole picker, written out (so pasting can't break a text match).
create or replace function sc_deezer_next(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v jsonb;
  v_artist text;
  v_album text;
begin
  if not sc_deezer_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  -- Finish an artist before starting another: unread releases first. Pick
  -- the artist (931 rows), then their next release.
  select a.id into v_artist
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
  end if;
  if v_album is not null then
    update deezer_albums set claimed_at = now() where artist_id = v_artist and album_id = v_album;
    return jsonb_build_object('kind', 'album', 'artist_id', v_artist, 'album_id', v_album);
  end if;

  -- Photos for artists found on Deezer who still have none (one call each).
  v_artist := null;
  select a.id into v_artist
  from artists a
  where a.deezer_artist_id is not null and a.image_url is null and a.deezer_photo_at is null
    and (a.deezer_claim_at is null or a.deezer_claim_at < now() - interval '2 minutes')
  order by a.id
  limit 1
  for update of a skip locked;
  if v_artist is not null then
    update artists set deezer_claim_at = now() where id = v_artist;
    return (select jsonb_build_object('kind', 'photo', 'artist_id', id, 'deezer_id', deezer_artist_id) from artists where id = v_artist);
  end if;

  select case when a.deezer_artist_id is null
              then jsonb_build_object('kind', 'search', 'artist_id', a.id, 'name', a.name)
              else jsonb_build_object('kind', 'list', 'artist_id', a.id, 'deezer_id', a.deezer_artist_id, 'index', coalesce(a.deezer_list_index, 0)) end,
         a.id
  into v, v_artist
  from artists a
  left join sc_artist_weights() w on w.artist_id = a.id
  left join artist_track_counts c on c.artist_id = a.id
  where ((a.deezer_artist_id is null and (a.deezer_lookup_at is null or a.deezer_lookup_at < now() - interval '60 days'))
      or (a.deezer_artist_id is not null and (a.deezer_list_index is not null or a.deezer_listed_at is null
                                              or a.deezer_listed_at < now() - interval '7 days')))
    and (a.deezer_claim_at is null or a.deezer_claim_at < now() - interval '2 minutes')
  order by a.deezer_list_index is not null desc, coalesce(w.weight, 0) desc,
           (a.deezer_artist_id is not null) desc, coalesce(c.n, 0) desc, a.id
  limit 1
  for update of a skip locked;
  if v_artist is not null then
    update artists set deezer_claim_at = now() where id = v_artist;
  end if;
  return v;
end;
$$;
