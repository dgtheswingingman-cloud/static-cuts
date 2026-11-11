-- Posts & picks, round two.
--  * On this day is 3 songs (different artists, not the song of the day's
--    artist), kept on the post so the home page and the picture agree.
--  * Song of the day can be chosen from a shortlist, any day ahead.
--  * A month calendar for the control room, and what the home page shows.

-- The 3 strongest songs that leaked or came out on this date in an earlier year.
create or replace function public.sc_social_pick_otd3(p_day date) returns text[]
language sql stable security definer set search_path to 'public' as $$
  with c as (
    select t.id, t.artist_id from tracks t
    where t.parent_track_id is null
      and to_char(p_day, 'MM-DD') <> '01-01' -- 1 January usually means only the year is known
      and ((t.leak_date is not null and to_char(t.leak_date, 'MM-DD') = to_char(p_day, 'MM-DD') and t.leak_date < p_day - 300)
        or (t.release_status = 'released' and t.release_date is not null
            and to_char(t.release_date, 'MM-DD') = to_char(p_day, 'MM-DD') and t.release_date < p_day - 300))
      and not exists (select 1 from social_posts s where s.post_date = p_day and s.kind = 'song_of_day' and s.ref ->> 'artist_id' = t.artist_id)),
  s as (select id, artist_id, sc_social_score(id, artist_id) sc from c),
  one as (select distinct on (artist_id) id, sc from s order by artist_id, sc desc, id),
  top as (select id from one where sc_track_cover(id) ->> 'url' is not null order by sc desc, id limit 3)
  select coalesce(array_agg(id), '{}') from top;
$$;

create or replace function public.sc_social_otd_count(p_day date) returns int
language sql stable security definer set search_path to 'public' as $$
  select count(*)::int from tracks t
  where t.parent_track_id is null and to_char(p_day, 'MM-DD') <> '01-01'
    and ((t.leak_date is not null and to_char(t.leak_date, 'MM-DD') = to_char(p_day, 'MM-DD') and t.leak_date < p_day - 300)
      or (t.release_status = 'released' and to_char(t.release_date, 'MM-DD') = to_char(p_day, 'MM-DD') and t.release_date < p_day - 300));
$$;

create or replace function public.sc_social_otd_captions(p_day date, songs jsonb) returns jsonb
language sql immutable as $$
  with s as (select x, n from jsonb_array_elements(songs) with ordinality as e(x, n)),
  l as (select string_agg((x ->> 'artist') || ' – ' || (x ->> 'title') || ' (' ||
      case when x ->> 'status' = 'released' then 'released ' || left(x ->> 'release_date', 4) else 'leaked ' || left(x ->> 'leak_date', 4) end || ')', E'\n' order by n) lines,
      string_agg(distinct sc_social_tag(x ->> 'artist'), ' ') tags from s)
  select jsonb_build_object(
    'instagram', 'ON THIS DAY // ' || upper(to_char(p_day, 'FMDD Month')) || E'\n\n' || l.lines
      || E'\n\nEvery song, leak and version: link in bio.\n\n#onthisday ' || l.tags || ' #staticcuts',
    'tiktok', 'on this day: ' || (select string_agg((x ->> 'title') || ' by ' || (x ->> 'artist'), ', ' order by n) from s)
      || ' #onthisday ' || l.tags || ' #fyp #staticcuts',
    'x', left('ON THIS DAY // ' || to_char(p_day, 'FMDD Mon') || E'\n' || l.lines, 250) || E'\nstatic-cuts.com/on-this-day')
  from l;
$$;

-- Song of the day shortlist: 12 options for a day (8 leaked or snippet, 4
-- released), strong and not posted in the last 180 days, shuffled by the day.
create or replace function public.sc_social_song_pool(p_day date, p_released boolean, p_n int) returns setof text
language sql stable security definer set search_path to 'public' as $$
  with recent as (
    select track_id, ref ->> 'artist_id' artist_id, post_date from social_posts
    where post_date > p_day - 180 and post_date <> p_day and kind = 'song_of_day'),
  c as (
    select t.id, t.artist_id from tracks t left join track_popularity tp on tp.track_id = t.id
    where t.parent_track_id is null
      and case when p_released then t.release_status = 'released' else t.release_status in ('leaked', 'snippet') end
      and (exists (select 1 from track_ownership o where o.track_id = t.id)
           or coalesce(tp.listeners, 0) >= 50
           or exists (select 1 from follows f where f.artist_id = t.artist_id))
      and not exists (select 1 from recent r where r.track_id = t.id)
      and not exists (select 1 from recent r where r.artist_id = t.artist_id and r.post_date > p_day - 7)
    order by coalesce(tp.listeners, 0) desc limit 4000),
  top as (select c.id, c.artist_id, sc_social_score(c.id, c.artist_id) s from c order by 3 desc limit 120),
  one as (select distinct on (artist_id) id from top order by artist_id, md5(id || p_day::text))
  select id from one where sc_track_cover(id) ->> 'url' is not null order by md5(id || p_day::text) limit p_n;
$$;

create or replace function public.sc_social_pick_song(p_day date) returns text
language sql stable security definer set search_path to 'public' as $$
  select id from sc_social_song_pool(p_day, extract(doy from p_day)::int % 3 = 0, 1) id;
$$;

-- Build (or rebuild) the day's posts: same as before, with on this day as 3.
create or replace function public.sc_social_put_otd(d date) returns void
language plpgsql security definer set search_path to 'public' as $$
declare ids text[]; songs jsonb;
begin
  ids := sc_social_pick_otd3(d);
  if coalesce(array_length(ids, 1), 0) = 0 then return; end if;
  select jsonb_agg(sc_social_song(x, d) order by n) into songs from unnest(ids) with ordinality u(x, n);
  insert into social_posts (post_date, kind, track_id, ref, captions)
  values (d, 'on_this_day', ids[1], jsonb_build_object('songs', songs, 'total', sc_social_otd_count(d)), sc_social_otd_captions(d, songs))
  on conflict (post_date, kind) do update set track_id = excluded.track_id, ref = excluded.ref, captions = excluded.captions
    where social_posts.posted = '{}';
end $$;

do $d$
declare src text := pg_get_functiondef('public.sc_social_build(date)'::regprocedure); n text; a int; b int;
begin
  a := position('  if not exists (select 1 from social_posts where post_date = d and kind = ''on_this_day'') then' in src);
  b := position('  if extract(isodow from d) = 1' in src);
  if a = 0 or b = 0 then raise exception 'not found'; end if;
  n := substr(src, 1, a - 1)
    || '  if not exists (select 1 from social_posts where post_date = d and kind = ''on_this_day'') then' || chr(10)
    || '    perform sc_social_put_otd(d); made := made + 1;' || chr(10) || '  end if;' || chr(10)
    || substr(src, b);
  -- the roundup only once the month is over
  n := replace(n, 'if extract(day from d) = 1 and not exists', 'if extract(day from d) = 1 and d <= (now() at time zone ''Europe/London'')::date and not exists');
  execute n;
end $d$;

-- Choose song of the day for a day (today or ahead; not once it's posted).
create or replace function public.admin_social_set_song(p_day date, p_track text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if exists (select 1 from social_posts where post_date = p_day and kind = 'song_of_day' and posted <> '{}') then raise exception 'already posted'; end if;
  r := sc_social_song(p_track, p_day);
  if r is null then raise exception 'song not found'; end if;
  insert into social_posts (post_date, kind, track_id, ref, captions) values (p_day, 'song_of_day', p_track, r, sc_social_song_captions('song_of_day', r))
  on conflict (post_date, kind) do update set track_id = excluded.track_id, ref = excluded.ref, captions = excluded.captions;
  -- on this day mustn't share the artist
  if exists (select 1 from social_posts where post_date = p_day and kind = 'on_this_day' and posted = '{}') then perform sc_social_put_otd(p_day); end if;
end $$;

create or replace function public.admin_social_song_shortlist(p_day date) returns jsonb
language plpgsql stable security definer set search_path to 'public' set statement_timeout to '60s' as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(sc_social_song(id, p_day) || jsonb_build_object(
      'listeners', (select listeners from track_popularity where track_id = id)))
    from (select id from sc_social_song_pool(p_day, false, 8) id union all select id from sc_social_song_pool(p_day, true, 4) id) x), '[]');
end $$;

-- After album of the week changes: remake that Monday's post if it's not posted.
create or replace function public.admin_social_refresh_aotw(p_week date) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  delete from social_posts where post_date = p_week and kind = 'album_of_week' and posted = '{}';
  if p_week <= (now() at time zone 'Europe/London')::date then perform sc_social_build(p_week); end if;
end $$;

-- Make a day's posts now (today or earlier), e.g. the roundup on the 1st.
create or replace function public.admin_social_make(p_day date) returns int
language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_day > (now() at time zone 'Europe/London')::date then raise exception 'posts for later days are made on the day'; end if;
  return sc_social_build(p_day);
end $$;

-- The control room calendar: a month of posts, plus the albums of the week.
create or replace function public.admin_social_calendar(p_month date) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare s date := date_trunc('month', p_month)::date; e date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'today', (now() at time zone 'Europe/London')::date,
    'posts', coalesce((select jsonb_agg(to_jsonb(p) order by p.post_date) from social_posts p where p.post_date >= s and p.post_date < e), '[]'),
    'aotw', coalesce((select jsonb_agg(jsonb_build_object('week_start', a.week_start, 'title', a.title, 'artist', ar.name, 'cover', a.cover) order by a.week_start)
      from aotw_picks a join artists ar on ar.id = a.artist_id where a.week_start >= s - 6 and a.week_start < e), '[]'));
end $$;

-- Home page: today's song of the day and on this day (the latest made).
create or replace function public.rpc_social_today() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'song', (select ref || jsonb_build_object('post_date', post_date) from social_posts where kind = 'song_of_day'
             and post_date <= (now() at time zone 'Europe/London')::date order by post_date desc limit 1),
    'otd', (select ref || jsonb_build_object('post_date', post_date) from social_posts where kind = 'on_this_day'
            and post_date = (now() at time zone 'Europe/London')::date));
$$;
grant execute on function public.rpc_social_today() to anon, authenticated;

drop function if exists public.admin_social_reroll(uuid);
drop function if exists public.sc_social_pick_otd(date);

revoke execute on function public.sc_social_pick_otd3(date), public.sc_social_otd_count(date), public.sc_social_song_pool(date, boolean, int),
  public.sc_social_put_otd(date), public.sc_social_pick_song(date) from anon, authenticated, public;

-- Remake the on this day posts made so far as 3 songs.
select public.sc_social_put_otd(post_date) from public.social_posts where kind = 'on_this_day' and posted = '{}';
