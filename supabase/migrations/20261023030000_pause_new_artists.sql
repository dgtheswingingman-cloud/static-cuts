-- Pause new artist pages, to focus on filling in the artists we have.
--
-- The only job that makes artist pages by itself is guest-artists (guests
-- on songs get their own page once Spotify confirms who they are). With
-- new_artists_paused = 'on' it does nothing at all, so it doesn't spend
-- Spotify calls either. Artists you or moderators add by hand still work.
--
-- Switch back on later with:
--   update sc_private_settings set value = 'off' where key = 'new_artists_paused';
--
-- Also: "work left on followed artists" (which makes guest-artists wait
-- before making new pages) now understands that artists with a Spotify
-- profile are covered by reading their releases, not by song-by-song search.
-- Without this it would wait forever.

insert into sc_private_settings (key, value) values ('new_artists_paused', 'on')
on conflict (key) do update set value = 'on';

create or replace function sc_existing_work_left()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select value from sc_private_settings where key = 'new_artists_paused'), 'off') = 'on'
    or exists (
      select 1 from artists a
      where a.id in (select artist_id from follows)
        and a.spotify_artist_id ~ '^[A-Za-z0-9]{22}$'
        and (a.spotify_albums_listed_at is null or a.spotify_albums_offset is not null
             or exists (select 1 from spotify_albums s where s.artist_id = a.id and s.fetched_at is null)))
    or (select count(*) from tracks t join artists a on a.id = t.artist_id
        where t.artist_id in (select artist_id from follows)
          and (coalesce(a.spotify_artist_id, '') !~ '^[A-Za-z0-9]{22}$'
               and t.spotify_url is null and t.spotify_search_attempted_at is null
               and coalesce(t.release_status, '') not in ('leaked', 'snippet', 'announced', 'rumored', 'teased')
               or t.genius_checked_at is null and (t.producers is null or t.featured_artists is null))) > 200;
$$;

-- guest-artists: nothing to do while paused.
do $$
declare
  d text := pg_get_functiondef('public.sc_guest_next(text, int)'::regprocedure);
  marker text := 'raise exception ''not authorized'';';
begin
  if position('new_artists_paused' in d) = 0 then
    d := regexp_replace(d, marker || '\s*end if;',
      marker || E'\n  end if;\n  -- Paused (new_artists_paused): no new pages, no Spotify calls.\n'
      || E'  if coalesce((select value from sc_private_settings where key = ''new_artists_paused''), ''off'') = ''on'' then\n'
      || E'    return jsonb_build_object(''known'', ''{}''::jsonb, ''new_pages'', false, ''guests'', ''[]''::jsonb);\n  end if;');
    if position('new_artists_paused' in d) = 0 then raise exception 'could not add the pause to sc_guest_next'; end if;
    execute d;
  end if;
end $$;
