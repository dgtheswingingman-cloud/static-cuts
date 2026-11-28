-- Two search-engine fixes for song pages.
--
-- 1. The sitemaps leave out "empty" songs: no status, album, dates, credits,
--    other versions or guest artists. Those pages are already marked
--    noindex (app/song/[id]/page.tsx isEmptySong), so listing them only
--    wastes Google's visits. Same test as isEmptySong. (~61,000 of 579,000.)
-- 2. rpc_song_page returns 'more': up to 12 other songs by the same artist,
--    shown on the server-built page as "More from <artist>", so every song
--    page links to others (helps Google find and value them). Released and
--    leaked songs first; the pick differs per page so the links spread out.

create or replace function public.sc_song_is_empty(t tracks)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) = 'unconfirmed'
     and coalesce(t.album, '') = '' and t.release_date is null and t.leak_date is null
     and coalesce(t.producers::text, '') = '' and coalesce(t.writers::text, '') = ''
     and t.parent_track_id is null
     and not exists (select 1 from tracks c where c.parent_track_id = t.id)
     and not exists (select 1 from track_appearances ap where ap.track_id = t.id and ap.artist_id <> t.artist_id);
$$;

create or replace function public.sc_sitemap_refresh()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_parts int;
begin
  insert into sitemap_parts (part, songs, refreshed_at)
  select p, jsonb_agg(id order by rn), now()
  from (select id, row_number() over (order by (parent_track_id is not null), id) rn,
               ((row_number() over (order by (parent_track_id is not null), id)) - 1) / 40000 as p
        from tracks t
        where not sc_song_is_empty(t)) x
  group by p
  on conflict (part) do update set songs = excluded.songs, refreshed_at = excluded.refreshed_at;
  select max(part) + 1 into v_parts from sitemap_parts where refreshed_at = now();
  update sitemap_parts set songs = '[]'::jsonb, refreshed_at = now() where part >= coalesce(v_parts, 0);
  return coalesce(v_parts, 0);
end;
$function$;

-- Add 'more' to rpc_song_page (patched in place so the rest stays as it is).
do $do$
declare
  v_def text := pg_get_functiondef('public.rpc_song_page(text)'::regprocedure);
  v_old text := $p$'my_rating', v_my,$p$;
  v_new text := $p$'my_rating', v_my,
    'more', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'release_status', m.release_status)
                                       order by m.rk, m.h), '[]'::jsonb)
             from (select o.id, o.title, o.release_status,
                          case when o.release_status in ('released', 'leaked') then 0 else 1 end rk,
                          md5(o.id || t.id) h
                   from tracks o
                   where o.artist_id = t.artist_id and o.parent_track_id is null and o.id <> v_main
                     and (o.release_status in ('released', 'leaked', 'snippet', 'teased', 'announced')
                          or o.is_official or coalesce(o.album, '') <> '')
                   order by 4, 5
                   limit 12) m),$p$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'rpc_song_page: anchor not found';
  end if;
  if position($p$'more',$p$ in v_def) > 0 then
    return; -- already patched
  end if;
  execute replace(v_def, v_old, v_new);
end;
$do$;

select public.sc_sitemap_refresh();
