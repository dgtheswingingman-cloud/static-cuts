-- Possible editions (11 Nov 2026): albums that are probably a deluxe of
-- another album but don't share its name (Ken Carson's "XTENDED" = "X" +
-- 5 songs; "xperiment - cartunez" = "xperiment" + 13). Found from the
-- tracklists: the later album, released within 18 months, has at least 90%
-- of the earlier album's songs and at most about twice as many. Greatest
-- hits, live, soundtrack and similar titles are left out. Nothing is
-- combined automatically: they're listed on /review/albums for a moderator
-- (combine / different albums). Refreshed nightly.

create table if not exists album_edition_candidates (
  album_id text not null,       -- the bigger, later album
  original_id text not null,    -- the album it seems to extend
  artist_id text not null references artists(id) on delete cascade,
  common int not null,
  original_songs int not null,
  songs int not null,
  found_at timestamptz not null default now(),
  primary key (album_id, original_id)
);
alter table album_edition_candidates enable row level security;

create table if not exists album_edition_dismissed (
  album_id text not null,
  original_id text not null,
  dismissed_by uuid,
  dismissed_at timestamptz not null default now(),
  primary key (album_id, original_id)
);
alter table album_edition_dismissed enable row level security;

create or replace function sc_find_possible_editions()
returns int language plpgsql security definer set search_path to 'public' set work_mem to '64MB' as $function$
declare n int;
begin
  delete from album_edition_candidates;
  with al as (
    select distinct on (d.album_id) d.album_id, d.artist_id, d.title, d.release_date, sc_album_grp(d.album_id, d.title) grp
    from deezer_albums d
    where d.kind in ('album', 'ep') and coalesce(d.review, '') <> 'remove' and d.release_date is not null
    order by d.album_id
  ),
  k as (select distinct at.album_id, sc_title_key(regexp_replace(at.title, '\s*[\(\[].*$', '')) key
        from album_tracks at join al on al.album_id = at.album_id),
  sz as (select album_id, count(*) n from k group by 1 having count(*) >= 6),
  common as (select ka.album_id a_id, kb.album_id b_id, count(*) c
             from k ka join k kb on kb.key = ka.key and kb.album_id <> ka.album_id group by 1, 2)
  insert into album_edition_candidates (album_id, original_id, artist_id, common, original_songs, songs)
  select distinct on (b.album_id) b.album_id, a.album_id, a.artist_id, c.c, sa.n, sb.n
  from common c join al a on a.album_id = c.a_id join al b on b.album_id = c.b_id
  join sz sa on sa.album_id = a.album_id join sz sb on sb.album_id = b.album_id
  where a.artist_id = b.artist_id and a.grp <> b.grp
    and b.release_date >= a.release_date and b.release_date <= a.release_date + interval '18 months'
    and sb.n > sa.n and sb.n <= 2 * sa.n + 6 and c.c >= 0.9 * sa.n
    and (a.title || ' ' || b.title) !~* '(greatest|hits|best of|collection|anthology|essential|live|archive|soundtrack|instrumental|karaoke|playlist|edits|compilation|original|sped up|slowed|chopped|screwed|a cappella|acapella)'
    and not exists (select 1 from album_edition_dismissed x where x.album_id = b.album_id and x.original_id = a.album_id)
  order by b.album_id, c.c desc, a.release_date desc
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke execute on function sc_find_possible_editions() from public, anon, authenticated;

create or replace function admin_possible_editions(p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'count', (select count(*) from album_edition_candidates c
              where sc_album_grp(c.album_id, (select title from deezer_albums where album_id = c.album_id limit 1))
                 <> sc_album_grp(c.original_id, (select title from deezer_albums where album_id = c.original_id limit 1))),
    'items', (select coalesce(jsonb_agg(x order by x.followers desc, x.artist, x.title), '[]'::jsonb) from (
      select c.album_id, c.original_id, c.artist_id, a.name artist, b.title, b.cover, b.release_date,
             o.title original_title, o.cover original_cover, o.release_date original_date,
             c.common, c.original_songs, c.songs, (select count(*) from follows f where f.artist_id = c.artist_id) followers
      from album_edition_candidates c join artists a on a.id = c.artist_id
      cross join lateral (select * from deezer_albums d where d.album_id = c.album_id limit 1) b
      cross join lateral (select * from deezer_albums d where d.album_id = c.original_id limit 1) o
      where sc_album_grp(b.album_id, b.title) <> sc_album_grp(o.album_id, o.title)
      order by (select count(*) from follows f where f.artist_id = c.artist_id) desc, a.name, b.title
      limit greatest(1, least(coalesce(p_limit, 200), 1000))) x));
end $function$;
revoke execute on function admin_possible_editions(int) from public, anon;
grant execute on function admin_possible_editions(int) to authenticated;

create or replace function admin_possible_edition_dismiss(p_album text, p_original text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  insert into album_edition_dismissed (album_id, original_id, dismissed_by) values (p_album, p_original, auth.uid()) on conflict do nothing;
  delete from album_edition_candidates where album_id = p_album and original_id = p_original;
  return jsonb_build_object('ok', true);
end $function$;
revoke execute on function admin_possible_edition_dismiss(text, text) from public, anon;
grant execute on function admin_possible_edition_dismiss(text, text) to authenticated;

select sc_find_possible_editions();
select cron.schedule('possible-editions', '27 4 * * *', $$ select public.sc_find_possible_editions(); $$);
