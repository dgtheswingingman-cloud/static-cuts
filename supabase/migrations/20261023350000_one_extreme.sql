-- 1. Deezer: no more "flat out". Just normal and extreme.
-- 2. Only one flat-out job at a time: Deezer extreme and Genius extreme (max)
--    can't run together (together they overloaded the database on 23 Oct).

-- Anything still on flat out goes back to normal.
update sc_private_settings set value = 'off' where key = 'deezer_turbo' and value = 'on';

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
  return case when v = 'extreme' then 'extreme' else 'off' end;
end;
$$;
revoke execute on function sc_deezer_mode(text) from public, anon, authenticated;

create or replace function owner_set_deezer_mode(p_mode text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_owner() then raise exception 'Only the owner can change this.'; end if;
  if p_mode not in ('normal', 'extreme') then raise exception 'Unknown mode.'; end if;
  if p_mode = 'extreme' and coalesce((select value from sc_private_settings where key = 'genius_pace'), 'normal') = 'max' then
    raise exception 'Genius is on extreme. Only one can go flat out at a time: set Genius back first.';
  end if;
  insert into sc_private_settings (key, value) values
    ('deezer_turbo', case p_mode when 'extreme' then 'extreme' else 'off' end),
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

create or replace function owner_set_genius_pace(p_pace text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_owner() then raise exception 'Only the owner can change this.'; end if;
  if p_pace not in ('normal', 'fast', 'max') then raise exception 'Unknown pace.'; end if;
  if p_pace = 'max' and coalesce((select value from sc_private_settings where key = 'deezer_turbo'), 'off') = 'extreme' then
    raise exception 'Deezer is on extreme. Only one can go flat out at a time: set Deezer back first.';
  end if;
  perform sc_set_genius_pace(p_pace, null);
end;
$$;
revoke execute on function owner_set_genius_pace(text) from public, anon;
grant execute on function owner_set_genius_pace(text) to authenticated;

create or replace function owner_deezer()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_owner() then jsonb_build_object(
    'turbo', coalesce((select value from sc_private_settings where key = 'deezer_turbo'), 'off') = 'extreme',
    'mode', case coalesce((select value from sc_private_settings where key = 'deezer_turbo'), 'off')
              when 'extreme' then 'extreme' else 'normal' end,
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
revoke execute on function owner_deezer() from public, anon;
grant execute on function owner_deezer() to authenticated;
