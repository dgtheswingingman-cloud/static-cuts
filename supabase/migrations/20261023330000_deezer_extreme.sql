-- Deezer "extreme": the site is paused for everyone but the owner (a "back
-- soon" screen) and five workers read releases at once (~450 calls a
-- minute; Deezer allows about 600). It switches itself back to normal and
-- un-pauses the site when everything's read, or after 3 hours at most.
-- Workers claim each piece of work so two never do the same one.

alter table deezer_albums add column if not exists claimed_at timestamptz;
alter table artists add column if not exists deezer_claim_at timestamptz;

insert into sc_private_settings (key, value) values ('site_paused', 'off') on conflict (key) do nothing;
update sc_private_settings set value = '450' where key = 'deezer_per_minute';
update sc_private_settings set value = '500000' where key = 'deezer_per_day';

-- The next piece of work, claimed (a claim lasts 2 minutes).
create or replace function sc_deezer_next(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v jsonb;
  v_artist text;
  v_album text;
begin
  if not sc_deezer_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  -- Finish an artist before starting another: unread releases first.
  select d.artist_id, d.album_id into v_artist, v_album
  from deezer_albums d join artists a on a.id = d.artist_id
  left join sc_artist_weights() w on w.artist_id = d.artist_id
  where d.fetched_at is null and a.deezer_list_index is null
    and (d.claimed_at is null or d.claimed_at < now() - interval '2 minutes')
  order by coalesce(w.weight, 0) desc, d.artist_id,
           case d.kind when 'album' then 0 when 'ep' then 1 else 2 end, d.release_date nulls last, d.album_id
  limit 1
  for update of d skip locked;
  if v_album is not null then
    update deezer_albums set claimed_at = now() where artist_id = v_artist and album_id = v_album;
    return jsonb_build_object('kind', 'album', 'artist_id', v_artist, 'album_id', v_album);
  end if;

  select case when a.deezer_artist_id is null
              then jsonb_build_object('kind', 'search', 'artist_id', a.id, 'name', a.name)
              else jsonb_build_object('kind', 'list', 'artist_id', a.id, 'deezer_id', a.deezer_artist_id, 'index', coalesce(a.deezer_list_index, 0)) end,
         a.id
  into v, v_artist
  from artists a
  left join sc_artist_weights() w on w.artist_id = a.id
  left join artist_track_counts c on c.artist_id = a.id
  where ((a.deezer_artist_id is null and (a.deezer_lookup_at is null or a.deezer_lookup_at < now() - interval '60 days'))
      or (a.deezer_artist_id is not null and (a.deezer_list_index is not null or a.deezer_listed_at is null
                                              or a.deezer_listed_at < now() - interval '30 days')))
    and (a.deezer_claim_at is null or a.deezer_claim_at < now() - interval '2 minutes')
  order by a.deezer_list_index is not null desc, coalesce(w.weight, 0) desc,
           (a.deezer_artist_id is not null) desc, coalesce(c.n, 0) desc, a.id
  limit 1
  for update of a skip locked;
  if v_artist is not null then
    update artists set deezer_claim_at = now() where id = v_artist;
  end if;
  return v;
end;
$$;
revoke execute on function sc_deezer_next(text) from public, anon, authenticated;

-- A claim is let go once the piece is saved (so the artist's next page or
-- releases can be picked up straight away).
create or replace function sc_deezer_unclaim(p_secret text, p_artist text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not sc_deezer_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  update artists set deezer_claim_at = null where id = p_artist;
end;
$$;
revoke execute on function sc_deezer_unclaim(text, text) from public, anon, authenticated;

-- Which pace to run at: 'off' (normal), 'on' (flat out) or 'extreme'.
-- Extreme ends itself after its time is up.
create or replace function sc_deezer_mode(p_secret text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v text := coalesce((select value from sc_private_settings where key = 'deezer_turbo'), 'off');
begin
  if not sc_deezer_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  if v = 'extreme' and coalesce(nullif((select value from sc_private_settings where key = 'deezer_extreme_until'), '')::timestamptz, now()) <= now() then
    perform sc_deezer_extreme_end();
    v := 'off';
  end if;
  return v;
end;
$$;
revoke execute on function sc_deezer_mode(text) from public, anon, authenticated;

create or replace function sc_deezer_extreme_end()
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into sc_private_settings (key, value) values ('deezer_turbo', 'off'), ('site_paused', 'off')
  on conflict (key) do update set value = excluded.value;
$$;
revoke execute on function sc_deezer_extreme_end() from public, anon, authenticated;

-- Extreme with nothing left to read: back to normal.
create or replace function sc_deezer_extreme_done(p_secret text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not sc_deezer_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  if (select value from sc_private_settings where key = 'deezer_turbo') = 'extreme' then
    perform sc_deezer_extreme_end();
  end if;
end;
$$;
revoke execute on function sc_deezer_extreme_done(text) from public, anon, authenticated;

-- Is the site paused? (Everyone's browser asks; only the owner gets in.)
create or replace function rpc_site_paused()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'paused', coalesce((select value from sc_private_settings where key = 'site_paused'), 'off') = 'on',
    'until', (select value from sc_private_settings where key = 'deezer_extreme_until'),
    'owner', is_owner());
$$;
grant execute on function rpc_site_paused() to anon, authenticated;

create or replace function owner_set_deezer_mode(p_mode text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_owner() then raise exception 'Only the owner can change this.'; end if;
  if p_mode not in ('normal', 'flat', 'extreme') then raise exception 'Unknown mode.'; end if;
  insert into sc_private_settings (key, value) values
    ('deezer_turbo', case p_mode when 'normal' then 'off' when 'flat' then 'on' else 'extreme' end),
    ('site_paused', case when p_mode = 'extreme' then 'on' else 'off' end)
  on conflict (key) do update set value = excluded.value;
  if p_mode = 'extreme' then
    insert into sc_private_settings (key, value) values ('deezer_extreme_until', (now() + interval '3 hours')::text)
    on conflict (key) do update set value = excluded.value;
  end if;
end;
$$;
revoke execute on function owner_set_deezer_mode(text) from public, anon;
grant execute on function owner_set_deezer_mode(text) to authenticated;

-- The owner panel's view, now with the mode.
create or replace function owner_deezer()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_owner() then jsonb_build_object(
    'turbo', coalesce((select value from sc_private_settings where key = 'deezer_turbo'), 'off') <> 'off',
    'mode', case coalesce((select value from sc_private_settings where key = 'deezer_turbo'), 'off')
              when 'on' then 'flat' when 'extreme' then 'extreme' else 'normal' end,
    'until', (select value from sc_private_settings where key = 'deezer_extreme_until'),
    'artists', (select count(*) from artists),
    'searched', (select count(*) from artists where deezer_lookup_at is not null),
    'linked', (select count(*) from artists where deezer_artist_id is not null),
    'releases_read', (select count(*) from deezer_albums where fetched_at is not null),
    'releases_left', (select count(*) from deezer_albums where fetched_at is null),
    'songs_linked', (select count(*) from tracks where deezer_url is not null),
    'calls_last_hour', (select coalesce(sum(calls), 0) from api_budget where service = 'deezer' and minute > now() - interval '1 hour')
  ) end;
$$;
