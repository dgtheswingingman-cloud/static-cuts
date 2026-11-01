-- New artists wait only for Deezer now. Before, adding new artists waited
-- for every service to finish the artists already here, including Genius
-- credits for ~15,000 leaked tracker songs Genius will never have, which
-- could hold new artists back for a week or more while Deezer sat idle.
--
-- Now each service just works through its own list; Deezer (where songs
-- come from) decides: once it has read every artist here, new artists are
-- added (up to new_artists_per_day), and guest artists it confirmed get
-- their pages. Genius, Last.fm, Spotify and Apple carry on with everyone,
-- new artists included.

create or replace function sc_deezer_caught_up()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select not exists (select 1 from deezer_albums where fetched_at is null)
     and not exists (select 1 from artists where deezer_artist_id is null and deezer_lookup_at is null)
     and not exists (select 1 from artists where deezer_artist_id is not null
                       and (deezer_listed_at is null or deezer_list_index is not null));
$$;

-- "Existing artists still being filled in": Deezer still has some of them to read.
create or replace function sc_existing_work_left()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select not sc_hold_new_catalogues() and not sc_deezer_caught_up();
$$;

-- Ready for new artists.
create or replace function sc_catalogue_sweep_done()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select sc_deezer_caught_up();
$$;

revoke execute on function sc_deezer_caught_up(), sc_existing_work_left(), sc_catalogue_sweep_done() from public, anon, authenticated;
