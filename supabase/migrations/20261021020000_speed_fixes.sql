-- Speed fixes (already applied on 19 Oct; kept here for the record).
-- Working out a title's key inside the lookup made the database redo it for
-- every song on the artist's page: the City Morgue tracker re-check timed
-- out. Now it's worked out once per row (14s -> 0.3s for 300 rows).

create or replace function sc_sheet_reconcile(p_source uuid, p_home text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  src sheet_sources%rowtype;
  it jsonb;
  v_ids text[];
  v_key text;
  t tracks%rowtype;
  v_status text;
  v_leak date;
  v_rel date;
  v_batch boolean := false;
  v_statuses int := 0;
  v_filled int := 0;
  v_disagree int := 0;
  v_same int := 0;
  v_n int;
begin
  select * into src from sheet_sources where id = p_source;
  if src.id is null then raise exception 'unknown sheet'; end if;

  perform set_config('static_cuts.credit_user', '', true);
  perform set_config('static_cuts.status_note', 'From ' || coalesce(src.title, 'a community tracker'), true);

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    -- The song this row is about: same tidied title on this artist's page,
    -- preferring a main song when a version shares the name.
    -- (The key is worked out once here: inside the query it was re-worked
    -- for every song on the page, which timed out on big trackers.)
    v_key := sc_title_key(it ->> 'title');
    continue when v_key is null or v_key = '';
    select array_agg(tk.track_id order by tk.is_main desc) into v_ids
    from track_title_keys tk
    where tk.artist_id = p_home and tk.key = v_key;
    continue when v_ids is null;
    -- Two main songs with the same name: too unsure to touch either.
    continue when cardinality(v_ids) > 1
      and (select count(*) from track_title_keys where track_id = any (v_ids) and is_main) > 1;
    select * into t from tracks where id = v_ids[1];
    continue when t.id is null;

    v_status := it ->> 'status_guess';
    if v_status not in ('rumored', 'teased', 'snippet', 'leaked', 'announced', 'released') then v_status := null; end if;
    v_leak := nullif(it -> 'extra' ->> 'leak_date', '')::date;
    v_rel := nullif(it ->> 'release_date', '')::date;

    -- One undo-history batch per run, started only once something changes.
    if not v_batch and (
         (v_status is not null and coalesce(t.release_status, 'unconfirmed') = 'unconfirmed')
      or (v_status is not null and t.release_status = v_status and t.status_source is null)
      or (t.leak_date is null and v_leak is not null)
      or (t.album is null and nullif(it ->> 'album', '') is not null)
      or (t.notes is null and nullif(it -> 'extra' ->> 'notes', '') is not null)
      or (t.producers is null and nullif(it -> 'extra' ->> 'producers', '') is not null)
      or (t.featured_artists is null and nullif(it -> 'extra' ->> 'featuring', '') is not null)) then
      perform sc_begin_batch('tracker', 'Tracker update: ' || coalesce(src.title, 'community tracker'));
      v_batch := true;
    end if;

    -- Status.
    if v_status is not null then
      if coalesce(t.release_status, 'unconfirmed') = 'unconfirmed' then
        update tracks set release_status = v_status, status_source = src.title, status_source_url = src.url
        where id = t.id;
        v_statuses := v_statuses + 1;
      elsif t.release_status = v_status then
        v_same := v_same + 1;
        if t.status_source is null then
          update tracks set status_source = src.title, status_source_url = src.url where id = t.id;
        end if;
      elsif t.release_status = 'released' and coalesce(t.spotify_url, '') like '%open.spotify.com%' then
        null; -- Spotify says it's out; a spreadsheet doesn't overrule that.
      else
        insert into tracker_disagreements (track_id, source_id, current_status, tracker_status, tracker_title)
        values (t.id, src.id, t.release_status, v_status, it ->> 'title')
        on conflict (track_id, source_id, tracker_status) do nothing;
        get diagnostics v_n = row_count;
        v_disagree := v_disagree + v_n;
      end if;
    end if;

    -- Empty details only.
    update tracks set
      leak_date = coalesce(leak_date, v_leak),
      album = coalesce(album, nullif(it ->> 'album', '')),
      release_date = coalesce(release_date, case when coalesce(v_status, release_status) = 'released' then v_rel end),
      notes = coalesce(notes, nullif(it -> 'extra' ->> 'notes', '')),
      producers = coalesce(producers, nullif(it -> 'extra' ->> 'producers', '')),
      featured_artists = coalesce(featured_artists, nullif(it -> 'extra' ->> 'featuring', ''))
    where id = t.id
      and ((leak_date is null and v_leak is not null)
        or (album is null and nullif(it ->> 'album', '') is not null)
        or (release_date is null and v_rel is not null and coalesce(v_status, release_status) = 'released')
        or (notes is null and nullif(it -> 'extra' ->> 'notes', '') is not null)
        or (producers is null and nullif(it -> 'extra' ->> 'producers', '') is not null)
        or (featured_artists is null and nullif(it -> 'extra' ->> 'featuring', '') is not null));
    get diagnostics v_n = row_count;
    v_filled := v_filled + v_n;
  end loop;

  perform set_config('static_cuts.status_note', '', true);
  return jsonb_build_object('statuses', v_statuses, 'details', v_filled, 'disagree', v_disagree, 'agreed', v_same);
end;
$$;
revoke execute on function sc_sheet_reconcile(uuid, text, jsonb) from public, anon, authenticated;

create or replace function rpc_match_my_songs(p_items jsonb, p_artist_id text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  it jsonb;
  v_artist text;
  v_track text;
  v_title text;
  v_key text;
  v_song text;
  out jsonb := '[]'::jsonb;
  n int := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    n := n + 1;
    exit when n > 3000;
    v_artist := coalesce(p_artist_id, sc_find_artist(it ->> 'artist'));
    v_track := null;
    v_title := null;
    v_key := sc_title_key(it ->> 'title');
    v_song := sc_song_key(it ->> 'title');
    if v_artist is not null and coalesce(v_key, '') <> '' then
      select t.id, t.title into v_track, v_title
      from track_title_keys tk join tracks t on t.id = tk.track_id
      where tk.artist_id = v_artist and tk.key = v_key
      order by tk.is_main desc limit 1;
      if v_track is null then
        select t.id, t.title into v_track, v_title
        from track_title_keys tk join tracks t on t.id = tk.track_id
        where tk.artist_id = v_artist and tk.song_key = v_song and v_song <> ''
        order by tk.is_main desc limit 1;
      end if;
    end if;
    out := out || jsonb_build_array(jsonb_build_object(
      'row', n, 'artist_in', it ->> 'artist', 'title_in', it ->> 'title', 'artist_id', v_artist,
      'track_id', v_track, 'title', v_title,
      'owned', v_track is not null and exists (select 1 from track_ownership where user_id = auth.uid() and track_id = v_track)));
  end loop;
  return out;
end;
$$;
revoke execute on function rpc_match_my_songs(jsonb, text) from public, anon;
grant execute on function rpc_match_my_songs(jsonb, text) to authenticated;
