-- cover-search: unconfirmed songs with an exact Deezer match become released.
create or replace function public.sc_cover_search_next(p_secret text, p_limit int default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(x) from (
    select t.id, t.title, a.name artist, t.deezer_url, t.apple_url, t.release_status, t.length_sec from tracks t join artists a on a.id = t.artist_id
    where t.parent_track_id is null and t.cover_url is null and t.release_status in ('released', 'unconfirmed')
      and not exists (select 1 from cover_search_checked c where c.track_id = t.id and c.checked_at > now() - interval '90 days')
    order by (t.release_status = 'released') desc, (t.deezer_url is not null or t.apple_url is not null) desc,
      (select count(*) from follows f where f.artist_id = t.artist_id) desc, t.id
    limit greatest(1, least(p_limit, 60))) x), '[]');
end $$;

-- Saves covers, and for unconfirmed songs Deezer has (exact artist + title,
-- length within 8 seconds when we know it): marks them released and fills the
-- Deezer link, album and length where empty. Quietly: no alerts, notifications
-- or "this week" entries (these are old catalogue songs, not news); each one is
-- recorded in cover_search_checked.found = 'deezer-search+released'.
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
    album = coalesce(nullif(trim(t.album), ''), nullif(trim(x ->> 'album'), '')),
    length_sec = coalesce(t.length_sec, case when x ->> 'length_sec' ~ '^\d{1,5}$' and (x ->> 'length_sec')::int between 1 and 36000 then (x ->> 'length_sec')::int end)
  from jsonb_array_elements(p_items) x
  where t.id = x ->> 'track_id' and x ->> 'how' = 'deezer-search' and (x ->> 'deezer_id') is not null;
  perform set_config('static_cuts.skip_status_log', '', true);
  return n;
end $$;
revoke execute on function public.sc_cover_search_save(text, jsonb), public.sc_cover_search_next(text, int) from anon, authenticated, public;

-- Monthly roundup: the headline number is unreleased songs filed that month
-- (leaks, snippets, teasers...), not catalogue imports of old released songs.
-- 'catalogue' keeps the count of everything else added, for reference.
create or replace function public.sc_social_monthly(p_month date)
 returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with m as (select date_trunc('month', p_month)::date s, (date_trunc('month', p_month) + interval '1 month')::date e),
  lk as (select t.id, t.title, a.name artist, a.id artist_id, t.leak_date as day from tracks t join artists a on a.id = t.artist_id, m
         where t.parent_track_id is null and t.leak_date >= m.s and t.leak_date < m.e),
  rl as (select t.id, t.title, a.name artist, a.id artist_id, t.release_date as day from tracks t join artists a on a.id = t.artist_id, m
         where t.parent_track_id is null and t.release_status = 'released' and t.release_date >= m.s and t.release_date < m.e),
  made as (select t.artist_id, t.release_status not in ('released', 'unconfirmed') vault from tracks t, m
           where t.parent_track_id is null
             and t.created_at >= m.s::timestamp at time zone 'Europe/London' and t.created_at < m.e::timestamp at time zone 'Europe/London'),
  added as (select artist_id, count(*) n from made where vault group by 1)
  select jsonb_build_object(
    'month', (select s from m),
    'added', (select count(*) from made where vault),
    'catalogue', (select count(*) from made where not vault),
    'leaked_n', (select count(*) from lk),
    'released_n', (select count(*) from rl),
    'members', (select count(*) from auth.users u, m where u.created_at >= m.s and u.created_at < m.e),
    'leaked', sc_weekly_slide_list((select coalesce(jsonb_agg(to_jsonb(lk)), '[]') from lk)),
    'released', sc_weekly_slide_list((select coalesce(jsonb_agg(to_jsonb(rl)), '[]') from rl)),
    'top_artists', (select coalesce(jsonb_agg(jsonb_build_object('artist', a.name, 'n', x.n, 'photo', a.image_url) order by x.n desc), '[]')
                    from (select * from added order by n desc limit 5) x join artists a on a.id = x.artist_id));
$function$;

do $$
declare src text; out text;
begin
  select pg_get_functiondef('public.sc_social_build(date)'::regprocedure) into src;
  if src not like '%songs added%' then return; end if;
  out := replace(src, $a$' songs added, '$a$, $a$' unreleased songs filed, '$a$);
  out := replace(out, $a$' songs added #leaks$a$, $a$' unreleased songs filed #leaks$a$);
  out := replace(out, $a$' songs added · '$a$, $a$' unreleased songs filed · '$a$);
  if out like '%songs added%' then raise exception 'sc_social_build captions not patched'; end if;
  execute out;
end $$;
-- (October's roundup post was rebuilt with the new numbers when this ran.)
