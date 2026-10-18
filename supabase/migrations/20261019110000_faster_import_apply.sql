-- Adding imported songs timed out ("0 songs added"): each song re-read the
-- whole artist's song list to check for duplicates (about 0.15s each for
-- big pages, so 100 songs went past the 8-second limit). Now each artist's
-- list is read once per click, and songs added in the same click count too.

create or replace function admin_apply_import_suggestions(p_ids uuid[], p_status text default null)
returns int
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  s import_suggestions%rowtype;
  v_id text;
  v_main text;
  v_home text;
  n int := 0;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_status is not null and p_status not in ('unconfirmed', 'rumored', 'teased', 'snippet', 'leaked', 'announced', 'released') then
    raise exception 'unknown status';
  end if;
  perform sc_begin_batch('import', 'Import review: ' || coalesce(array_length(p_ids, 1), 0) || ' approved');
  perform set_config('static_cuts.skip_status_log', 'on', true);

  -- Every song already on these artists' pages, read once.
  create temp table if not exists _sc_apply_known (artist_id text, k text) on commit drop;
  truncate _sc_apply_known;
  insert into _sc_apply_known
  select a.artist_id, k.k
  from (select distinct artist_id from import_suggestions where id = any (p_ids[1:300]) and state = 'open') a,
       lateral sc_known_keys(a.artist_id) k;

  for s in select * from import_suggestions where id = any (p_ids[1:300]) and state = 'open' order by title loop
    if exists (select 1 from _sc_apply_known where artist_id = s.artist_id
               and k in (sc_title_key(s.title), sc_song_key(s.title))) then
      update import_suggestions set state = 'dismissed', decided_at = now() where id = s.id;
      continue;
    end if;
    v_main := case when s.main_artist_name is not null then sc_find_artist(s.main_artist_name) end;
    v_home := coalesce(v_main, s.artist_id);
    perform set_config('static_cuts.credit_user', coalesce((select requested_by::text from import_runs where id = s.run_id), ''), true);
    v_id := v_home || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    insert into tracks (id, artist_id, title, release_status, album, release_date, is_featured, featured_artists,
                        source, source_url, notes, producers, spotify_url)
    values (v_id, v_home, s.title, coalesce(p_status, s.status_guess), s.album, s.release_date,
            v_main is null and s.main_artist_name is not null,
            nullif(s.extra ->> 'featuring', ''),
            s.source, s.url,
            case when v_main is null and s.main_artist_name is not null
                 then 'Feature on ' || s.main_artist_name || '''s song.' else nullif(s.extra ->> 'notes', '') end,
            nullif(s.extra ->> 'producers', ''), nullif(s.extra ->> 'listen_url', ''));
    if v_main is not null then
      insert into track_appearances (track_id, artist_id) values (v_id, s.artist_id) on conflict do nothing;
    end if;
    insert into _sc_apply_known values (s.artist_id, sc_title_key(s.title)), (s.artist_id, sc_song_key(s.title));
    update import_suggestions set state = 'applied', decided_at = now() where id = s.id;
    n := n + 1;
  end loop;
  return n;
end;
$fn$;
