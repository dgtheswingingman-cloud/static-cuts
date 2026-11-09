-- Faster pages (9 Nov 2026), from timing the site's own calls:
--   - big artist pages: the song list was 4.3 MB for Kanye (14k songs). Empty
--     fields are left out and source_url dropped (the song panel loads it
--     with the other details when opened): about 2.3 MB.
--   - profiles: contributions took ~2 s and the page asks twice. Kept for
--     10 minutes per person.
--   - home feed: "what's new" is cached for 10 minutes but the first visitor
--     after that waited ~1 s. A timer keeps it warm.

create or replace function rpc_artist_tracks(p_artist_id text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(x order by x ->> 'title'), '[]'::jsonb) from (
    select jsonb_strip_nulls(jsonb_build_object('id', t.id, 'title', t.title, 'spotify_url', t.spotify_url, 'parent_track_id', t.parent_track_id,
             'is_featured', t.is_featured, 'is_official', t.is_official, 'aliases', t.aliases,
             'release_status', t.release_status, 'source', t.source)) x
    from tracks t where t.artist_id = p_artist_id
    union all
    select jsonb_strip_nulls(jsonb_build_object('id', t.id, 'title', t.title, 'spotify_url', t.spotify_url, 'parent_track_id', t.parent_track_id,
             'is_featured', true, 'is_official', t.is_official, 'aliases', t.aliases,
             'release_status', t.release_status, 'source', t.source,
             'isCrossAppearance', true, 'homeArtistId', t.artist_id, 'homeArtistName', a.name))
    from track_appearances ap join tracks t on t.id = ap.track_id join artists a on a.id = t.artist_id
    where ap.artist_id = p_artist_id and t.artist_id <> p_artist_id
  ) s;
$function$;

create or replace function rpc_user_contributions(p_user uuid)
returns jsonb language plpgsql security definer set search_path to 'public' set work_mem to '32MB' as $function$
declare
  v jsonb;
  v_key text := 'contrib:' || p_user;
begin
  if not sc_contributions_visible(p_user) then
    return jsonb_build_object('visible', false);
  end if;
  select data into v from home_cache where key = v_key and refreshed_at > now() - interval '10 minutes';
  if v is not null then return v; end if;
  with e as materialized (select * from sc_contribution_events(p_user))
  select jsonb_build_object(
    'visible', true,
    'totals', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from e group by kind) x),
    'total', (select count(*) from e),
    'recent', (select coalesce(jsonb_agg(to_jsonb(r) order by r.at desc), '[]'::jsonb) from (
                 select e.kind, e.at, e.track_id, e.title, e.artist_id, a.name as artist_name
                 from e left join artists a on a.id = e.artist_id
                 order by e.at desc limit 30) r)
  ) into v;
  insert into home_cache (key, data, refreshed_at) values (v_key, v, now())
  on conflict (key) do update set data = excluded.data, refreshed_at = excluded.refreshed_at;
  return v;
end;
$function$;

select cron.schedule('whats-new-warm', '*/9 * * * *', $$
  select public.rpc_whats_new(null, 'all', false, 7);
  select public.rpc_whats_new(null, 'all', false, 3);
$$);
