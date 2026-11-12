-- Every check counts: an unconfirmed song with an official link (Apple Music,
-- Deezer or a Spotify track link) is out, so it's marked released.
-- Quietly (no alerts / "this week" entries: these are old catalogue songs),
-- in one undoable batch.

-- 1. Songs that already have one.
do $d$
begin
  perform sc_begin_batch('official-links', 'Unconfirmed songs with an Apple Music / Deezer / Spotify link marked released');
  perform set_config('static_cuts.skip_status_log', 'on', true);
  update tracks set release_status = 'released'
  where parent_track_id is null and release_status = 'unconfirmed'
    and (apple_url is not null or deezer_url is not null or spotify_url ~* '^https://open\.spotify\.com/track/');
  perform set_config('static_cuts.skip_status_log', '', true);
end $d$;

-- 2. The Apple Music job marks them as it links them.
do $d$
declare src text := pg_get_functiondef('public.sc_apple_album_save(text, text, text, jsonb)'::regprocedure); n text;
begin
  if position('''unconfirmed'' then ''released''' in src) > 0 then return; end if;
  n := replace(src, $q$    apple_url = coalesce(t.apple_url, m.url),$q$,
    $q$    apple_url = coalesce(t.apple_url, m.url),
    release_status = case when t.release_status = 'unconfirmed' and t.parent_track_id is null then 'released' else t.release_status end,$q$);
  n := replace(n, $q$release_date = case when t.release_date is null and t.release_status = 'released' then m.released else t.release_date end,$q$,
    $q$release_date = case when t.release_date is null and t.release_status in ('released', 'unconfirmed') then m.released else t.release_date end,$q$);
  n := replace(n, $q$    and (t.apple_url is null or$q$, $q$    and (t.apple_url is null or (t.release_status = 'unconfirmed' and t.parent_track_id is null) or$q$);
  if n = src then raise exception 'sc_apple_album_save not patched'; end if;
  execute n;
end $d$;

-- 3. Cover search: any official find marks it (Apple / Deezer link or search),
--    and Apple search results fill the Apple link too.
create or replace function public.sc_cover_search_save(p_secret text, p_items jsonb) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  insert into cover_search_checked (track_id, found)
  select x ->> 'track_id', x ->> 'how' || case when (x ->> 'released')::boolean then '+released' else '' end from jsonb_array_elements(p_items) x
  on conflict (track_id) do update set checked_at = now(), found = excluded.found;
  update tracks t set cover_url = x ->> 'cover_url', cover_checked_at = now()
  from jsonb_array_elements(p_items) x
  where t.id = x ->> 'track_id' and t.cover_url is null and x ->> 'cover_url' ~ '^https://';
  get diagnostics n = row_count;
  perform set_config('static_cuts.skip_status_log', 'on', true);
  update tracks t set
    release_status = case when (x ->> 'released')::boolean and t.release_status = 'unconfirmed' then 'released' else t.release_status end,
    deezer_url = coalesce(t.deezer_url, case when x ->> 'deezer_id' ~ '^\d+$' then 'https://www.deezer.com/track/' || (x ->> 'deezer_id') end),
    apple_url = coalesce(t.apple_url, case when x ->> 'apple_url' ~ '^https://music\.apple\.com/' then x ->> 'apple_url' end),
    album = coalesce(nullif(trim(t.album), ''), nullif(trim(x ->> 'album'), '')),
    release_date = coalesce(t.release_date, case when x ->> 'release_date' ~ '^\d{4}-\d{2}-\d{2}$' then (x ->> 'release_date')::date end),
    length_sec = coalesce(t.length_sec, case when x ->> 'length_sec' ~ '^\d{1,5}$' and (x ->> 'length_sec')::int between 1 and 36000 then (x ->> 'length_sec')::int end)
  from jsonb_array_elements(p_items) x
  where t.id = x ->> 'track_id' and ((x ->> 'released')::boolean or (x ->> 'deezer_id') is not null or (x ->> 'apple_url') is not null);
  perform set_config('static_cuts.skip_status_log', '', true);
  return n;
end $$;
revoke execute on function public.sc_cover_search_save(text, jsonb) from anon, authenticated, public;

-- 4. Unconfirmed songs the search found nothing for get another go (now with
--    the Apple search too).
update cover_search_checked c set checked_at = now() - interval '100 days'
from tracks t where t.id = c.track_id and t.release_status = 'unconfirmed' and c.found = 'none';
