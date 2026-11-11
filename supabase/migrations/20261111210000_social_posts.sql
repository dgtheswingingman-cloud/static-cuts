-- Daily social posts, made ready for a person to post by hand (Instagram,
-- TikTok, X). Every day: song of the day and on this day. Mondays: album of
-- the week. The 1st: last month's roundup. Each post keeps a snapshot of what
-- it shows (ref) so the pictures stay the same, a caption per platform, and
-- when it was posted on each.

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  post_date date not null,
  kind text not null check (kind in ('song_of_day', 'on_this_day', 'album_of_week', 'monthly')),
  track_id text references public.tracks(id) on delete set null,
  ref jsonb not null default '{}',
  captions jsonb not null default '{}',
  posted jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (post_date, kind)
);
alter table public.social_posts enable row level security;

create or replace function public.sc_social_tag(p text) returns text language sql immutable as $$
  select '#' || lower(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- A song as a post snapshot.
create or replace function public.sc_social_song(p_track text, p_day date) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', t.id, 'title', t.title, 'artist', a.name, 'artist_id', a.id, 'status', t.release_status,
    'album', nullif(t.album, ''), 'leak_date', t.leak_date, 'release_date', t.release_date,
    'cover', sc_track_cover(t.id) ->> 'url', 'photo', a.image_url,
    'collectors', (select count(*) from track_ownership o where o.track_id = t.id),
    'versions', (select count(*) from tracks v where v.parent_track_id = t.id),
    'years_ago', extract(year from p_day)::int - extract(year from coalesce(
      case when t.release_status = 'released' then t.release_date end, t.leak_date))::int)
  from tracks t join artists a on a.id = t.artist_id where t.id = p_track;
$$;

-- How much a song is likely to land: listeners, people here collecting it,
-- followers and Deezer fans of the artist.
create or replace function public.sc_social_score(p_track text, p_artist text) returns numeric
language sql stable security definer set search_path to 'public' as $$
  select ln(1 + coalesce((select listeners from track_popularity where track_id = p_track), 0))
    + 2 * (select count(*) from track_ownership where track_id = p_track)
    + 3 * (select count(*) from follows where artist_id = p_artist)
    + 0.5 * ln(1 + coalesce((select deezer_fans from artists where id = p_artist), 0));
$$;

-- Song of the day: leaked or snippet songs two days in three, released the
-- third. Picked from the strongest 40 (not posted in the last 180 days, and
-- not an artist used in the last 7), the same pick for the same day.
create or replace function public.sc_social_pick_song(p_day date) returns text
language sql stable security definer set search_path to 'public' as $$
  with recent as (
    select track_id, ref ->> 'artist_id' artist_id, post_date from social_posts
    where post_date > p_day - 180 and post_date <> p_day and kind in ('song_of_day', 'on_this_day')),
  c as (
    select t.id, t.artist_id from tracks t left join track_popularity tp on tp.track_id = t.id
    where t.parent_track_id is null
      and case when extract(doy from p_day)::int % 3 = 0 then t.release_status = 'released'
               else t.release_status in ('leaked', 'snippet') end
      and (exists (select 1 from track_ownership o where o.track_id = t.id)
           or exists (select 1 from track_popularity p where p.track_id = t.id and p.listeners >= 50)
           or exists (select 1 from follows f where f.artist_id = t.artist_id))
      and not exists (select 1 from recent r where r.track_id = t.id)
      and not exists (select 1 from recent r where r.artist_id = t.artist_id and r.post_date > p_day - 7)
    order by coalesce(tp.listeners, 0) desc limit 4000),
  top as (select c.id, sc_social_score(c.id, c.artist_id) s from c order by 2 desc limit 40)
  select id from top where sc_track_cover(id) ->> 'url' is not null
  order by md5(id || p_day::text) limit 1;
$$;

-- On this day: the strongest song that leaked or came out on this date in an
-- earlier year.
create or replace function public.sc_social_pick_otd(p_day date) returns text
language sql stable security definer set search_path to 'public' as $$
  with c as (
    select t.id, t.artist_id from tracks t
    where t.parent_track_id is null
      and ((t.leak_date is not null and to_char(t.leak_date, 'MM-DD') = to_char(p_day, 'MM-DD') and t.leak_date < p_day - 300)
        or (t.release_status = 'released' and t.release_date is not null
            and to_char(t.release_date, 'MM-DD') = to_char(p_day, 'MM-DD') and t.release_date < p_day - 300))
      and to_char(p_day, 'MM-DD') <> '01-01' -- 1 January usually means only the year is known
      and not exists (select 1 from social_posts s where s.track_id = t.id and s.post_date > p_day - 365 and s.post_date <> p_day)
      and not exists (select 1 from social_posts s where s.post_date = p_day and s.kind = 'song_of_day' and s.ref ->> 'artist_id' = t.artist_id))
  select id from c where sc_track_cover(id) ->> 'url' is not null
  order by sc_social_score(id, artist_id) desc, id limit 1;
$$;

create or replace function public.sc_social_song_captions(p_kind text, r jsonb) returns jsonb
language plpgsql immutable as $$
declare
  head text := case p_kind when 'song_of_day' then 'SONG OF THE DAY' else 'ON THIS DAY' end;
  leaked boolean := r ->> 'status' <> 'released';
  d date := case when leaked then (r ->> 'leak_date')::date else (r ->> 'release_date')::date end;
  -- 1 January usually means only the year is known.
  ds text := case when d is null then null when to_char(d, 'MM-DD') = '01-01' then 'in ' || to_char(d, 'YYYY') else to_char(d, 'FMDD Mon YYYY') end;
  st text := case r ->> 'status' when 'released' then 'Released' when 'snippet' then 'Snippet' when 'leaked' then 'Leaked' else initcap(r ->> 'status') end;
  line text;
  link text := 'static-cuts.com/song/' || (r ->> 'id');
  tag text := sc_social_tag(r ->> 'artist');
begin
  if p_kind = 'on_this_day' then
    line := (r ->> 'years_ago') || ' year' || case when (r ->> 'years_ago') = '1' then '' else 's' end || ' ago today, '
      || (r ->> 'title') || ' by ' || (r ->> 'artist') || case when leaked then ' leaked.' else ' came out.' end;
  else
    line := st || coalesce(' ' || ds, '') || coalesce(case when not leaked then ' on ' || (r ->> 'album') end, '') || '.'
      || case when leaked then ' Never officially released.' else '' end;
  end if;
  return jsonb_build_object(
    'instagram', head || ' // ' || (r ->> 'artist') || ' – ' || (r ->> 'title') || E'\n' || line
      || case when (r ->> 'versions')::int > 0 then E'\n' || (r ->> 'versions') || ' other version' || case when (r ->> 'versions') = '1' then '' else 's' end || ' on the site.' else '' end
      || E'\n\nEvery song, leak and version: link in bio.\n\n'
      || case when p_kind = 'song_of_day' then '#songoftheday ' else '#onthisday ' end || tag
      || case when leaked then ' #leaks #unreleased' else ' #newmusic' end || ' #staticcuts',
    'tiktok', lower(head) || ': ' || (r ->> 'title') || ' by ' || (r ->> 'artist') || '. ' || line || ' '
      || case when p_kind = 'song_of_day' then '#songoftheday ' else '#onthisday ' end || tag
      || case when leaked then ' #leaks #unreleased' else '' end || ' #fyp #staticcuts',
    'x', head || ' // ' || (r ->> 'artist') || ' – ' || (r ->> 'title') || E'\n' || line || E'\n' || link);
end $$;

-- Last month's roundup.
create or replace function public.sc_social_monthly(p_month date) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with m as (select date_trunc('month', p_month)::date s, (date_trunc('month', p_month) + interval '1 month')::date e),
  lk as (select t.id, t.title, a.name artist, a.id artist_id, t.leak_date as day from tracks t join artists a on a.id = t.artist_id, m
         where t.parent_track_id is null and t.leak_date >= m.s and t.leak_date < m.e),
  rl as (select t.id, t.title, a.name artist, a.id artist_id, t.release_date as day from tracks t join artists a on a.id = t.artist_id, m
         where t.parent_track_id is null and t.release_status = 'released' and t.release_date >= m.s and t.release_date < m.e),
  added as (select t.artist_id, count(*) n from tracks t, m
            where t.created_at >= m.s::timestamp at time zone 'Europe/London' and t.created_at < m.e::timestamp at time zone 'Europe/London' group by 1)
  select jsonb_build_object(
    'month', (select s from m),
    'added', coalesce((select sum(n) from added), 0),
    'leaked_n', (select count(*) from lk),
    'released_n', (select count(*) from rl),
    'members', (select count(*) from auth.users u, m where u.created_at >= m.s and u.created_at < m.e),
    'leaked', sc_weekly_slide_list((select coalesce(jsonb_agg(to_jsonb(lk)), '[]') from lk)),
    'released', sc_weekly_slide_list((select coalesce(jsonb_agg(to_jsonb(rl)), '[]') from rl)),
    'top_artists', (select coalesce(jsonb_agg(jsonb_build_object('artist', a.name, 'n', x.n, 'photo', a.image_url) order by x.n desc), '[]')
                    from (select * from added order by n desc limit 5) x join artists a on a.id = x.artist_id));
$$;

-- Make the day's posts (keeps any already made).
create or replace function public.sc_social_build(p_day date default null) returns int
language plpgsql security definer set search_path to 'public' set statement_timeout to '120s' as $$
declare
  d date := coalesce(p_day, (now() at time zone 'Europe/London')::date);
  t text; r jsonb; made int := 0; a record; mon text;
begin
  if not exists (select 1 from social_posts where post_date = d and kind = 'song_of_day') then
    t := sc_social_pick_song(d);
    if t is not null then
      r := sc_social_song(t, d);
      insert into social_posts (post_date, kind, track_id, ref, captions) values (d, 'song_of_day', t, r, sc_social_song_captions('song_of_day', r));
      made := made + 1;
    end if;
  end if;
  if not exists (select 1 from social_posts where post_date = d and kind = 'on_this_day') then
    t := sc_social_pick_otd(d);
    if t is not null then
      r := sc_social_song(t, d);
      insert into social_posts (post_date, kind, track_id, ref, captions) values (d, 'on_this_day', t, r, sc_social_song_captions('on_this_day', r));
      made := made + 1;
    end if;
  end if;
  if extract(isodow from d) = 1 and not exists (select 1 from social_posts where post_date = d and kind = 'album_of_week') then
    select p.*, ar.name artist into a from aotw_picks p join artists ar on ar.id = p.artist_id where p.week_start = d;
    if found then
      r := jsonb_build_object('artist', a.artist, 'artist_id', a.artist_id, 'title', a.title, 'year', a.year, 'cover', a.cover,
        'unreleased', a.unreleased, 'released', a.released, 'highlights', to_jsonb(a.highlights), 'blurb', a.blurb, 'week_start', a.week_start);
      insert into social_posts (post_date, kind, ref, captions) values (d, 'album_of_week', r, jsonb_build_object(
        'instagram', 'ALBUM OF THE WEEK // ' || a.artist || ' – ' || a.title || coalesce(' (' || a.year || ')', '')
          || coalesce(E'\n\n' || a.blurb, '') || E'\n\n' || a.unreleased || ' unreleased songs from the era on Static Cuts. Swipe for the vault, link in bio.'
          || E'\n\n#albumoftheweek ' || sc_social_tag(a.artist) || ' ' || sc_social_tag(a.title) || ' #unreleased #staticcuts',
        'tiktok', 'album of the week: ' || a.title || ' by ' || a.artist || '. ' || a.unreleased || ' unreleased songs from the era #albumoftheweek '
          || sc_social_tag(a.artist) || ' #unreleased #fyp #staticcuts',
        'x', 'ALBUM OF THE WEEK // ' || a.artist || ' – ' || a.title || coalesce(' (' || a.year || ')', '') || E'\n'
          || a.unreleased || ' unreleased songs from the era.' || E'\nstatic-cuts.com/weekly'));
      made := made + 1;
    end if;
  end if;
  if extract(day from d) = 1 and not exists (select 1 from social_posts where post_date = d and kind = 'monthly') then
    r := sc_social_monthly((d - 1));
    mon := trim(to_char(d - 1, 'Month'));
    insert into social_posts (post_date, kind, ref, captions) values (d, 'monthly', r, jsonb_build_object(
      'instagram', 'STATIC CUTS // ' || upper(mon) || ' ROUNDUP' || E'\n' || to_char((r ->> 'added')::bigint, 'FM999,999,990') || ' songs added, ' || (r ->> 'leaked_n') || ' leaks, '
        || to_char((r ->> 'released_n')::bigint, 'FM999,999,990') || ' releases.'
        || coalesce(E'\n\nBiggest leaks: ' || (select string_agg((x ->> 'artist') || ' – ' || (x ->> 'title'), ', ') from (select x from jsonb_array_elements(r -> 'leaked') x limit 3) y), '')
        || E'\n\nSwipe for the lot, link in bio.\n\n#' || lower(mon) || 'roundup #leaks #newmusic #staticcuts',
      'tiktok', lower(mon) || ' on static cuts: ' || (r ->> 'leaked_n') || ' leaks, ' || to_char((r ->> 'released_n')::bigint, 'FM999,999,990') || ' releases, ' || to_char((r ->> 'added')::bigint, 'FM999,999,990') || ' songs added #leaks #newmusic #fyp #staticcuts',
      'x', 'STATIC CUTS // ' || upper(mon) || ' ROUNDUP' || E'\n' || to_char((r ->> 'added')::bigint, 'FM999,999,990') || ' songs added · ' || (r ->> 'leaked_n') || ' leaks · ' || to_char((r ->> 'released_n')::bigint, 'FM999,999,990') || ' releases'
        || E'\nstatic-cuts.com/weekly'));
    made := made + 1;
  end if;
  return made;
end $$;

-- Pictures read a post through this (anyone; there's nothing private in it).
create or replace function public.rpc_social_post(p_id uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('id', id, 'kind', kind, 'post_date', post_date, 'ref', ref) from social_posts where id = p_id;
$$;
grant execute on function public.rpc_social_post(uuid) to anon, authenticated;

-- Control room list.
create or replace function public.admin_social_posts(p_from date default null, p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare d date := coalesce(p_from, (now() at time zone 'Europe/London')::date);
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(to_jsonb(s) order by s.post_date desc,
      array_position(array['monthly', 'album_of_week', 'song_of_day', 'on_this_day'], s.kind))
    from social_posts s where s.post_date <= d and s.post_date > d - greatest(1, least(p_days, 60))), '[]');
end $$;

create or replace function public.admin_social_mark(p_id uuid, p_platform text, p_posted boolean) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_platform not in ('instagram', 'tiktok', 'x') then raise exception 'unknown platform'; end if;
  update social_posts set posted = case when p_posted then posted || jsonb_build_object(p_platform, now()) else posted - p_platform end
  where id = p_id;
end $$;

create or replace function public.admin_social_caption(p_id uuid, p_platform text, p_text text) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_platform not in ('instagram', 'tiktok', 'x') then raise exception 'unknown platform'; end if;
  update social_posts set captions = captions || jsonb_build_object(p_platform, p_text) where id = p_id;
end $$;

-- Pick another song (song of the day / on this day only, and only before
-- it's been posted anywhere). Returns the new post id.
create or replace function public.admin_social_reroll(p_id uuid) returns uuid
language plpgsql security definer set search_path to 'public' set statement_timeout to '60s' as $$
declare p social_posts; v_t text; v_r jsonb; nid uuid;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  select * into p from social_posts where id = p_id;
  if p.kind not in ('song_of_day', 'on_this_day') then raise exception 'only songs can be swapped'; end if;
  if p.posted <> '{}' then raise exception 'already posted'; end if;
  -- Another strong song of the same kind (leaked or released), by a different artist.
  if p.kind = 'song_of_day' then
    v_t := (with recent as (select track_id from social_posts where post_date > p.post_date - 180 and kind in ('song_of_day', 'on_this_day'))
      select id from (
        select t.id, sc_social_score(t.id, t.artist_id) s from tracks t
        where t.parent_track_id is null
          and case when p.ref ->> 'status' = 'released' then t.release_status = 'released' else t.release_status in ('leaked', 'snippet') end
          and t.id <> p.track_id and t.artist_id <> p.ref ->> 'artist_id'
          and not exists (select 1 from recent x where x.track_id = t.id)
          and (exists (select 1 from track_ownership o where o.track_id = t.id)
               or exists (select 1 from track_popularity x where x.track_id = t.id and x.listeners >= 50)
               or exists (select 1 from follows f where f.artist_id = t.artist_id))
        limit 4000) c
      where sc_track_cover(id) ->> 'url' is not null
      order by s desc, md5(id || now()::text) limit 1 offset (floor(random() * 20))::int);
  else
    v_t := (select t.id from tracks t
      where t.parent_track_id is null and t.id <> p.track_id
        and ((t.leak_date is not null and to_char(t.leak_date, 'MM-DD') = to_char(p.post_date, 'MM-DD') and t.leak_date < p.post_date - 300)
          or (t.release_status = 'released' and to_char(t.release_date, 'MM-DD') = to_char(p.post_date, 'MM-DD') and t.release_date < p.post_date - 300))
        and not exists (select 1 from social_posts s where s.track_id = t.id and s.post_date > p.post_date - 365)
        and sc_track_cover(t.id) ->> 'url' is not null
      order by sc_social_score(t.id, t.artist_id) desc, t.id limit 1 offset (floor(random() * 5))::int);
  end if;
  if v_t is null then raise exception 'no other song found'; end if;
  v_r := sc_social_song(v_t, p.post_date);
  update social_posts set track_id = v_t, ref = v_r, captions = sc_social_song_captions(p.kind, v_r) where id = p_id returning id into nid;
  return nid;
end $$;

revoke execute on function public.sc_social_build(date), public.sc_social_pick_song(date), public.sc_social_pick_otd(date),
  public.sc_social_song(text, date), public.sc_social_monthly(date), public.sc_social_score(text, text) from anon, authenticated, public;

select cron.schedule('social-posts', '7 0 * * *', $$ select public.sc_social_build(); $$);
