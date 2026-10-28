-- Health check, 28 Oct.
-- 1. Genius credits' to-do list read ~49k pages (all 210k unchecked songs)
--    to pick 15, too much for the 1 GB database, so it timed out most runs.
--    Now: the highest-weighted artists first, each read from an index in
--    the order wanted, so it only touches the songs it hands out.
-- 2. Background jobs (service role) get 30 s per query instead of 8 s; the
--    hourly spreadsheet sync had outgrown 8 s since the song list doubled.
--    Visitors (anon / signed in) keep their 3 s / 8 s limits.

create index if not exists tracks_genius_todo_order_idx
  on tracks (artist_id, (parent_track_id is not null), (release_status in ('released', 'leaked')) desc, id)
  where genius_checked_at is null and genius_song_id is null
    and (producers is null or featured_artists is null or cover_url is null);

create index if not exists tracks_genius_todo_song_idx
  on tracks (id)
  where genius_checked_at is null and genius_song_id is not null
    and (producers is null or featured_artists is null or cover_url is null);

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

  -- Then artists in order of interest, main songs and released/leaked first.
  if v_left > 0 then
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
      order by (t.parent_track_id is not null), (t.release_status in ('released', 'leaked')) desc, t.id
      limit v_left;
      get diagnostics n = row_count;
      v_left := v_left - n;
      exit when v_left <= 0;
    end loop;
  end if;

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
revoke execute on function sc_genius_credit_next(text, integer) from public, anon, authenticated;

-- The older, wider to-do index isn't needed any more.
drop index if exists tracks_genius_todo_idx;

-- Background jobs: 30 s per query.
alter role service_role set statement_timeout = '30s';
notify pgrst, 'reload config';
