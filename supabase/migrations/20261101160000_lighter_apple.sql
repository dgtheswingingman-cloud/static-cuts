-- The Apple Music job slowed the whole site on its first evening (home page
-- "statement timeout"): each release it read for a big artist worked out
-- the title of every one of their songs again (Kanye: 13,000+), 6 s a time.
-- It now looks up only the titles on that release, using the saved title
-- keys (indexed). Already run on 1 Nov.

create or replace function sc_apple_artist_try(p_secret text, p_artist text, p_apple_id text, p_albums jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not sc_apple_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  -- Kept when a release title is a song or album title on the page (cheap
  -- lookups: saved title keys, plain album names).
  if not exists (
    select 1 from jsonb_array_elements(coalesce(p_albums, '[]'::jsonb)) x
    where coalesce(x ->> 'title', '') <> ''
      and (exists (select 1 from track_title_keys tk where tk.artist_id = p_artist and tk.key = sc_title_key(x ->> 'title') and tk.key <> '')
           or exists (select 1 from tracks t where t.artist_id = p_artist and lower(t.album) = lower(x ->> 'title')))
  ) then
    return false;
  end if;
  update artists set apple_artist_id = p_apple_id, apple_checked_at = now(), apple_claim_at = null where id = p_artist;
  insert into apple_albums (artist_id, album_id, title)
  select p_artist, x ->> 'id', left(x ->> 'title', 300) from jsonb_array_elements(coalesce(p_albums, '[]'::jsonb)) x
  where coalesce(x ->> 'id', '') <> '' and coalesce(x ->> 'title', '') <> ''
  on conflict (artist_id, album_id) do nothing;
  return true;
end;
$$;

create or replace function sc_apple_album_save(p_secret text, p_artist text, p_album text, p_tracks jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n int;
begin
  if not sc_apple_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  perform set_config('static_cuts.batch_id', sc_job_batch('apple', 'Apple Music links')::text, true);
  perform set_config('static_cuts.skip_status_log', 'on', true);
  -- Match each Apple song to the page by its saved title key (indexed),
  -- one song per title: the main song rather than a copy or version.
  update tracks t set apple_url = m.url
  from (
    select distinct on (x.k) tk.track_id, x.url
    from (select sc_title_key(e ->> 'title') k, e ->> 'url' url
          from jsonb_array_elements(coalesce(p_tracks, '[]'::jsonb)) e
          where coalesce(e ->> 'url', '') ~ '^https://music\.apple\.com/') x
    join track_title_keys tk on tk.key = x.k and tk.artist_id = p_artist
    join tracks tt on tt.id = tk.track_id
    where coalesce(x.k, '') <> ''
    order by x.k, tt.parent_track_id is not null, tt.spotify_url is null, tt.id
  ) m
  where t.id = m.track_id and t.apple_url is null;
  get diagnostics v_n = row_count;
  update apple_albums set fetched_at = now(), claimed_at = null where artist_id = p_artist and album_id = p_album;
  perform set_config('static_cuts.batch_id', '', true);
  return v_n;
end;
$$;
revoke execute on function sc_apple_artist_try(text, text, text, jsonb), sc_apple_album_save(text, text, text, jsonb) from public, anon, authenticated;
create index if not exists tracks_id_artist_idx on tracks (id) include (artist_id);
