-- Genius credits: released songs first, across every artist, before any
-- leaks. It used to go artist by artist (most followed first), so it spent
-- days on Kanye's and Uzi's ~15,000 leaked tracker songs (which Genius
-- rarely has) before reaching other artists' released songs (which it
-- almost always has). Same calls, far more filled in.
-- Also: new artists a day 10 -> 30 (Deezer has plenty of room).

update sc_private_settings set value = '30' where key = 'new_artists_per_day';

create or replace function sc_genius_credit_next(p_secret text, p_limit integer default 15)
returns table(track_id text, title text, artist text, genius_artist_id text, genius_song_id bigint)
language plpgsql
security definer
set search_path to 'public'
set work_mem to '32MB'
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 15), 400));
  v_left int;
  n int;
  a record;
  pass int;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;

  -- Songs already matched to a Genius song (just need its details) first.
  return query
  select t.id, t.title, ar.name, ar.genius_artist_id, t.genius_song_id
  from tracks t
  join artists ar on ar.id = t.artist_id
  left join sc_artist_weights() w on w.artist_id = t.artist_id
  where t.genius_checked_at is null and t.genius_song_id is not null
    and (t.producers is null or t.featured_artists is null or t.cover_url is null)
  order by coalesce(w.weight, 0) desc, (t.parent_track_id is not null), (t.release_status in ('released', 'leaked')) desc, t.id
  limit v_limit;
  get diagnostics n = row_count;
  v_left := v_limit - n;

  -- Then by artist (most followed first): pass 1 only released (and
  -- unconfirmed) main songs, the ones Genius has; pass 2 the rest.
  for pass in 1..2 loop
    exit when v_left <= 0;
    for a in
      select ar.id, ar.name, ar.genius_artist_id
      from artists ar left join sc_artist_weights() w on w.artist_id = ar.id
      order by coalesce(w.weight, 0) desc, ar.id
    loop
      return query
      select t.id, t.title, a.name, a.genius_artist_id, t.genius_song_id
      from tracks t
      where t.artist_id = a.id and t.genius_checked_at is null and t.genius_song_id is null
        and (t.producers is null or t.featured_artists is null or t.cover_url is null)
        and (pass = 2 or (t.parent_track_id is null and coalesce(t.release_status, 'unconfirmed') in ('released', 'unconfirmed')))
      order by (t.parent_track_id is not null), (t.release_status in ('released', 'leaked')) desc, t.id
      limit v_left;
      get diagnostics n = row_count;
      v_left := v_left - n;
      exit when v_left <= 0;
    end loop;
  end loop;

  -- Nothing new: re-check songs last checked over 60 days ago.
  if v_left = v_limit then
    return query
    select t.id, t.title, ar.name, ar.genius_artist_id, t.genius_song_id
    from tracks t join artists ar on ar.id = t.artist_id
    where t.genius_checked_at < now() - interval '60 days'
      and (t.producers is null or t.featured_artists is null or t.cover_url is null)
    order by t.genius_checked_at
    limit v_limit;
  end if;
end;
$$;
