-- Album of the week.
--   1. Every Thursday the site makes a shortlist of 8 albums for the coming
--      week (sc_aotw_build): one per artist, scored on what people here follow
--      and have in their Spotify libraries, plus how many unreleased songs the
--      archive has from that era, with some shuffle so it isn't the same names
--      every week. Artists picked in the last 8 weeks and albums already picked
--      are left out.
--   2. Claude writes a short blurb for each (aotw-blurb job).
--   3. The owner picks one on /review/album-of-the-week (and can edit the
--      blurb). It shows on the home page and /weekly from that Monday, and a
--      slide image is made for Instagram/TikTok.
-- Albums come from Deezer's album list (real releases), matched to the
-- archive's eras by title.

create table if not exists aotw_candidates (
  week_start date not null,
  artist_id text not null,
  album_key text not null,
  title text not null,
  year int,
  cover text,
  era_key text,
  unreleased int not null default 0,
  released int not null default 0,
  highlights text[] not null default '{}',
  score numeric not null default 0,
  reasons text,
  blurb text,
  ai_at timestamptz,
  claim_at timestamptz,
  retired boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (week_start, artist_id, album_key)
);

create table if not exists aotw_picks (
  week_start date primary key,
  artist_id text not null,
  album_key text not null,
  title text not null,
  year int,
  cover text,
  era_key text,
  unreleased int not null default 0,
  released int not null default 0,
  highlights text[] not null default '{}',
  blurb text,
  picked_at timestamptz not null default now()
);

alter table aotw_candidates enable row level security;
alter table aotw_picks enable row level security;
create policy "Public can read album of the week" on aotw_picks for select using (week_start <= (now() at time zone 'Europe/London')::date);

create or replace function sc_aotw_monday(p_day date)
returns date language sql immutable as $$ select p_day - ((extract(isodow from p_day)::int + 6) % 7) $$;

-- Make (or remake) the shortlist for a week.
create or replace function sc_aotw_build(p_week date)
returns int
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $$
declare v_week date := sc_aotw_monday(p_week); n int;
begin
  update aotw_candidates set retired = true where week_start = v_week and not retired;

  with alb as (
    select distinct on (d.artist_id, sc_normalize_title(regexp_replace(d.title, '\s*[\(\[].*$', '')))
      d.artist_id, sc_normalize_title(regexp_replace(d.title, '\s*[\(\[].*$', '')) k,
      regexp_replace(d.title, '\s*[\(\[].*$', '') title, d.release_date rel, d.cover
    from deezer_albums d join artists a on a.id = d.artist_id
    where d.kind = 'album' and coalesce(d.review, '') <> 'remove' and coalesce(d.songs, 0) >= 6
      and d.release_date is not null and d.release_date < v_week - 180 and not a.catalogue_hold
    order by 1, 2, d.release_date),
  eras as (
    select t.artist_id, sc_normalize_title(regexp_replace(t.album, '\s*[\(\[].*$', '')) k,
      'album:' || lower(mode() within group (order by t.album)) era_key,
      count(*) filter (where t.release_status <> 'released') unrel,
      count(*) filter (where t.release_status = 'released' and t.parent_track_id is null) rel_n
    from tracks t where coalesce(t.album, '') <> '' group by 1, 2),
  interest as (
    select a.id artist_id,
      (select count(*) from follows f where f.artist_id = a.id) fol,
      (select count(*) from spotify_library_artists l where l.spotify_artist_id = a.spotify_artist_id) lib
    from artists a),
  scored as (
    select al.*, e.era_key, coalesce(e.unrel, 0) unrel, coalesce(e.rel_n, 0) rel_n,
      extract(year from al.rel)::int yr,
      i.fol, i.lib,
      i.fol * 3 + i.lib * 2 + ln(1 + coalesce(e.unrel, 0)) * 2 + random() * 8 score
    from alb al
    join interest i on i.artist_id = al.artist_id
    left join eras e on e.artist_id = al.artist_id and e.k = al.k
    where not exists (select 1 from aotw_picks p where p.artist_id = al.artist_id and p.week_start >= v_week - 56 and p.week_start <> v_week)
      and not exists (select 1 from aotw_picks p where p.artist_id = al.artist_id and p.album_key = al.k and p.week_start <> v_week)
      and (i.fol + i.lib > 0 or coalesce(e.unrel, 0) >= 10)),
  best as (select distinct on (artist_id) * from scored order by artist_id, score desc),
  top as (select * from best order by score desc limit 8)
  insert into aotw_candidates (week_start, artist_id, album_key, title, year, cover, era_key, unreleased, released, highlights, score, reasons, retired)
  select v_week, t.artist_id, t.k, t.title, t.yr, t.cover, t.era_key, t.unrel, t.rel_n,
    coalesce((select array_agg(x.title) from (
       select tr.title from tracks tr
       where tr.artist_id = t.artist_id and tr.release_status in ('leaked', 'snippet') and tr.parent_track_id is null
         and sc_normalize_title(regexp_replace(coalesce(tr.album, ''), '\s*[\(\[].*$', '')) = t.k
       order by tr.release_status = 'leaked' desc, tr.leak_date desc nulls last, tr.title limit 6) x), '{}'),
    round(t.score::numeric, 1),
    concat_ws(' · ',
      case when t.fol > 0 then t.fol || ' follow' || case when t.fol = 1 then '' else 's' end end,
      case when t.lib > 0 then 'in ' || t.lib || ' librar' || case when t.lib = 1 then 'y' else 'ies' end end,
      case when t.unrel > 0 then t.unrel || ' unreleased from the era' end),
    false
  from top t
  on conflict (week_start, artist_id, album_key) do update set retired = false, score = excluded.score, reasons = excluded.reasons,
    unreleased = excluded.unreleased, released = excluded.released, highlights = excluded.highlights, cover = excluded.cover, year = excluded.year;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function sc_aotw_build(date) from public, anon, authenticated;

-- Claude's blurbs: the job takes a few at a time.
create or replace function sc_aotw_blurb_next(p_secret text, p_limit int default 8)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  with c as (
    select c.week_start, c.artist_id, c.album_key from aotw_candidates c
    where not c.retired and c.blurb is null and c.week_start >= current_date - 7
      and (c.claim_at is null or c.claim_at < now() - interval '10 minutes')
    order by c.week_start, c.score desc limit p_limit
    for update skip locked),
  u as (
    update aotw_candidates x set claim_at = now() from c
    where x.week_start = c.week_start and x.artist_id = c.artist_id and x.album_key = c.album_key
    returning x.*)
  select coalesce(jsonb_agg(jsonb_build_object('week_start', u.week_start, 'artist_id', u.artist_id, 'album_key', u.album_key,
    'artist', a.name, 'title', u.title, 'year', u.year, 'unreleased', u.unreleased, 'released', u.released, 'highlights', u.highlights)), '[]')
  into v from u join artists a on a.id = u.artist_id;
  return v;
end;
$$;
revoke execute on function sc_aotw_blurb_next(text, int) from public, anon, authenticated;

create or replace function sc_aotw_blurb_save(p_secret text, p_items jsonb)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare n int;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  update aotw_candidates c set blurb = left(i ->> 'blurb', 600), ai_at = now(), claim_at = null
  from jsonb_array_elements(coalesce(p_items, '[]')) i
  where c.week_start = (i ->> 'week_start')::date and c.artist_id = i ->> 'artist_id' and c.album_key = i ->> 'album_key'
    and coalesce(i ->> 'blurb', '') <> '';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function sc_aotw_blurb_save(text, jsonb) from public, anon, authenticated;

-- Admin: the shortlist for a week (made now if there isn't one).
create or replace function admin_aotw_candidates(p_week date, p_rebuild boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_week date := sc_aotw_monday(p_week);
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_rebuild or not exists (select 1 from aotw_candidates where week_start = v_week and not retired) then
    perform sc_aotw_build(v_week);
  end if;
  return jsonb_build_object(
    'week_start', v_week,
    'pick', (select to_jsonb(p) || jsonb_build_object('artist', a.name) from aotw_picks p join artists a on a.id = p.artist_id where p.week_start = v_week),
    'candidates', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('artist', a.name) order by c.score desc)
      from aotw_candidates c join artists a on a.id = c.artist_id where c.week_start = v_week and not c.retired), '[]'));
end;
$$;
grant execute on function admin_aotw_candidates(date, boolean) to authenticated;

create or replace function admin_aotw_pick(p_week date, p_artist text, p_album_key text, p_blurb text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_week date := sc_aotw_monday(p_week); c aotw_candidates;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  select * into c from aotw_candidates where week_start = v_week and artist_id = p_artist and album_key = p_album_key;
  if c is null then raise exception 'not on the shortlist'; end if;
  insert into aotw_picks (week_start, artist_id, album_key, title, year, cover, era_key, unreleased, released, highlights, blurb)
  values (v_week, c.artist_id, c.album_key, c.title, c.year, c.cover, c.era_key, c.unreleased, c.released, c.highlights,
          nullif(trim(coalesce(p_blurb, c.blurb, '')), ''))
  on conflict (week_start) do update set artist_id = excluded.artist_id, album_key = excluded.album_key, title = excluded.title,
    year = excluded.year, cover = excluded.cover, era_key = excluded.era_key, unreleased = excluded.unreleased,
    released = excluded.released, highlights = excluded.highlights, blurb = excluded.blurb, picked_at = now();
  if p_blurb is not null then
    update aotw_candidates set blurb = p_blurb where week_start = v_week and artist_id = p_artist and album_key = p_album_key;
  end if;
end;
$$;
grant execute on function admin_aotw_pick(date, text, text, text) to authenticated;

-- Everyone: this week's album (or a given week's, once that week has come).
create or replace function rpc_album_of_week(p_week date default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select to_jsonb(p) || jsonb_build_object('artist', a.name)
  from aotw_picks p join artists a on a.id = p.artist_id
  where p.week_start <= (now() at time zone 'Europe/London')::date
    and (p_week is null or p.week_start = sc_aotw_monday(p_week))
  order by p.week_start desc limit 1;
$$;
grant execute on function rpc_album_of_week(date) to anon, authenticated;

-- Thursdays 09:17: next week's shortlist.
select cron.schedule('aotw-shortlist', '17 9 * * 4', $cmd$ select public.sc_aotw_build(public.sc_aotw_monday(current_date + 7)); $cmd$);

-- Every 10 minutes, only when a shortlisted album has no blurb yet: Claude writes it.
select cron.schedule('aotw-blurb', '3-59/10 * * * *', $cmd$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := jsonb_build_object('fn', 'aotw-blurb', 'body', '{}'::jsonb),
    timeout_milliseconds := 15000)
  where exists (select 1 from public.aotw_candidates c where not c.retired and c.blurb is null and c.week_start >= current_date - 7);
$cmd$);
