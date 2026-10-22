-- Change of plan for the "new artists" switch: new artist pages ARE still
-- made (guests on songs get their page as usual), but while the switch is
-- off their catalogue isn't filled in automatically: no Spotify release
-- reading or song searches, no Genius or Last.fm imports for them. That keeps
-- every call on filling in the artists you already have.
--
-- Artists made by automatic jobs while it's off get artists.catalogue_hold.
-- Turning the switch back on lifts the hold on all of them. Pressing an
-- import button on a held artist's page still works. Approving submissions
-- and adding artists by hand aren't affected.

alter table artists add column if not exists catalogue_hold boolean not null default false;

-- The switch: 'on' = hold new artists' catalogues. Replaces new_artists_paused.
insert into sc_private_settings (key, value)
select 'hold_new_catalogues', coalesce((select value from sc_private_settings where key = 'new_artists_paused'), 'on')
on conflict (key) do nothing;
delete from sc_private_settings where key = 'new_artists_paused';

create or replace function sc_hold_new_catalogues()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select value from sc_private_settings where key = 'hold_new_catalogues'), 'off') = 'on';
$$;

-- New artists from automatic jobs (guest pages, tracker imports) are held
-- while the switch is off. Artists added by a person aren't.
create or replace function sc_artists_hold_new()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if sc_hold_new_catalogues()
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role' then
    new.catalogue_hold := true;
  end if;
  return new;
end;
$$;
drop trigger if exists artists_hold_new on artists;
create trigger artists_hold_new before insert on artists for each row execute function sc_artists_hold_new();

-- guest-artists: back to normal, and while catalogues are held it doesn't
-- wait for existing artists to be filled in first (the new pages stay
-- empty, so they don't compete for calls).
do $$
declare
  d text := pg_get_functiondef('public.sc_guest_next(text, int)'::regprocedure);
begin
  d := regexp_replace(d, '\n  -- Paused \(new_artists_paused\)[^\n]*\n  if [^\n]*\n    return [^\n]*\n  end if;', '');
  if position('new_artists_paused' in d) > 0 then raise exception 'could not remove the old pause from sc_guest_next'; end if;
  execute d;
end $$;

create or replace function sc_existing_work_left()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select not sc_hold_new_catalogues() and (
    exists (
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
               or t.genius_checked_at is null and (t.producers is null or t.featured_artists is null))) > 200);
$$;

-- Genius / Last.fm timer imports skip held artists.
do $$
declare
  d text := pg_get_functiondef('public.sc_claim_artists(text, int, int)'::regprocedure);
begin
  if position('catalogue_hold' in d) = 0 then
    d := replace(d, 'select q.artist_id from sc_artist_queue(200, true) q',
                    'select q.artist_id from sc_artist_queue(200, true) q' || E'\n'
                    || '    join artists ah on ah.id = q.artist_id and not ah.catalogue_hold');
    if position('catalogue_hold' in d) = 0 then raise exception 'could not add the hold to sc_claim_artists'; end if;
    execute d;
  end if;
end $$;

-- Spotify song-by-song search skips held artists.
create or replace function sc_spotify_match_next(p_limit integer default 10)
returns table(id text, title text, release_status text, album text, release_date date, artist text, others text[])
language sql
stable
security definer
set search_path to 'public'
as $$
  with todo as (
    select t.id, t.title, t.release_status, t.album, t.release_date, t.artist_id,
           row_number() over (partition by t.artist_id order by (t.parent_track_id is null) desc, t.id) turn
    from tracks t
    join artists a0 on a0.id = t.artist_id
    where t.spotify_url is null and t.spotify_search_attempted_at is null
      and coalesce(t.release_status, '') not in ('leaked', 'snippet', 'announced', 'rumored', 'teased')
      and coalesce(a0.spotify_artist_id, '') !~ '^[A-Za-z0-9]{22}$'
      and not a0.catalogue_hold
  )
  select d.id, d.title, d.release_status, d.album, d.release_date, a.name,
         array(select a2.name from track_appearances ap join artists a2 on a2.id = ap.artist_id where ap.track_id = d.id)
  from todo d
  join artists a on a.id = d.artist_id
  left join sc_artist_weights() w on w.artist_id = d.artist_id
  order by (coalesce(w.weight, 0) > 0) desc, d.turn, coalesce(w.weight, 0) desc, d.artist_id
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

-- Spotify release reading skips held artists, unless someone pressed
-- "import from Spotify" on their page or liked one of their songs.
create or replace function sc_spotify_album_next()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with waiting as (
    select jsonb_build_object('kind', 'album', 'artist_id', a.id, 'spotify_artist_id', a.spotify_artist_id,
                              'album_id', s.album_id) j
    from spotify_albums s join artists a on a.id = s.artist_id
    where s.fetched_at is null and a.spotify_artist_id ~ '^[A-Za-z0-9]{22}$'
      and exists (select 1 from spotify_liked_pending p where p.artist_id = s.artist_id and p.album_id = s.album_id)
    order by s.listed_at
    limit 1
  ), cand as (
    select a.id, a.spotify_artist_id, a.spotify_albums_offset,
           (a.spotify_albums_offset is not null or a.spotify_albums_listed_at is null
            or a.spotify_albums_listed_at < now() - interval '30 days') as list_due,
           exists (select 1 from spotify_albums s where s.artist_id = a.id and s.fetched_at is null) as has_albums,
           exists (select 1 from import_runs r where r.artist_id = a.id and r.source = 'spotify'
                   and r.finished_at is null) as requested,
           a.catalogue_hold
    from artists a
    where a.spotify_artist_id ~ '^[A-Za-z0-9]{22}$'
  ), pick as (
    select c.* from cand c left join sc_artist_weights() w on w.artist_id = c.id
    where (c.list_due or c.has_albums) and (not c.catalogue_hold or c.requested)
    order by c.requested desc, (coalesce(w.weight, 0) > 0) desc,
             (c.spotify_albums_offset is not null or c.has_albums) desc,
             coalesce(w.weight, 0) desc, c.id
    limit 1
  )
  select coalesce((select j from waiting), case
    when p.id is null then null
    when p.list_due then jsonb_build_object('kind', 'list', 'artist_id', p.id, 'spotify_artist_id', p.spotify_artist_id,
                                            'offset', coalesce(p.spotify_albums_offset, 0))
    else (select jsonb_build_object('kind', 'album', 'artist_id', p.id, 'spotify_artist_id', p.spotify_artist_id,
                                    'album_id', s.album_id)
          from spotify_albums s where s.artist_id = p.id and s.fetched_at is null
          order by case s.grp when 'album' then 0 when 'single' then 1 else 2 end, s.album_id limit 1)
  end)
  from (select 1) one left join pick p on true;
$$;
revoke execute on function sc_spotify_album_next() from public, anon, authenticated;

-- The control room switch (same functions, new meaning): on = fill in new
-- artists' catalogues as usual. Turning it on lifts every hold.
create or replace function owner_set_new_artists(p_on boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_owner() then raise exception 'Only the owner can change this.'; end if;
  insert into sc_private_settings (key, value) values ('hold_new_catalogues', case when p_on then 'off' else 'on' end)
  on conflict (key) do update set value = excluded.value;
  if p_on then
    update artists set catalogue_hold = false where catalogue_hold;
  end if;
end;
$$;

create or replace function owner_new_artists()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_owner() then jsonb_build_object(
    'on', not sc_hold_new_catalogues(),
    'held', (select count(*) from artists where catalogue_hold)) end;
$$;
