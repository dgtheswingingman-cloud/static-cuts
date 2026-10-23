-- 1. Deezer and Genius both have just two paces: normal and extreme.
--    (Deezer "flat out" and Genius "fast" are gone; they go back to normal.)
-- 2. Genius extreme works like Deezer's: the site is paused for everyone
--    else, and it ends by itself after 3 hours or when there's nothing left.
-- 3. Only one extreme at a time (together they overloaded the database on
--    23 Oct): the second one is refused.

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

-- Genius "fast" goes back to normal.
do $$ begin
  if (select value from sc_private_settings where key = 'genius_pace') = 'fast' then
    perform sc_set_genius_pace('normal', null);
  end if;
end $$;

-- Genius extreme over: back to normal and the site comes back.
create or replace function sc_genius_extreme_end(p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform sc_set_genius_pace('normal', p_note);
  if coalesce((select value from sc_private_settings where key = 'deezer_turbo'), 'off') <> 'extreme' then
    insert into sc_private_settings (key, value) values ('site_paused', 'off')
    on conflict (key) do update set value = excluded.value;
  end if;
end;
$$;
revoke execute on function sc_genius_extreme_end(text) from public, anon, authenticated;

-- The pace for the genius-credits job: 'normal' or 'max' (extreme).
-- Extreme ends itself once its time is up.
create or replace function sc_genius_pace(p_secret text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v text;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then return null; end if;
  v := coalesce((select value from sc_private_settings where key = 'genius_pace'), 'normal');
  if v = 'max' and coalesce(nullif((select value from sc_private_settings where key = 'genius_extreme_until'), '')::timestamptz, now()) <= now() then
    perform sc_genius_extreme_end('Extreme finished its 3 hours at ' || to_char(now() at time zone 'Europe/London', 'HH24:MI DD Mon') || '.');
    v := 'normal';
  end if;
  return case when v = 'max' then 'max' else 'normal' end;
end;
$$;
revoke execute on function sc_genius_pace(text) from public, anon, authenticated;

-- Extreme with nothing left to check: back to normal.
create or replace function sc_genius_extreme_done(p_secret text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  if (select value from sc_private_settings where key = 'genius_pace') = 'max' then
    perform sc_genius_extreme_end('Extreme finished at ' || to_char(now() at time zone 'Europe/London', 'HH24:MI DD Mon') || ': every song has been checked.');
  end if;
end;
$$;
revoke execute on function sc_genius_extreme_done(text) from public, anon, authenticated;

-- Genius said slow down: extreme goes back to normal (and the site comes back).
create or replace function sc_genius_slowed(p_secret text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v text := coalesce((select value from sc_private_settings where key = 'genius_pace'), 'normal');
  n text := 'Genius asked us to slow down at ' || to_char(now() at time zone 'Europe/London', 'HH24:MI DD Mon') || '; went back to normal.';
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  if v = 'max' then perform sc_genius_extreme_end(n); else perform sc_set_genius_pace('normal', n); end if;
  return 'normal';
end;
$$;
revoke execute on function sc_genius_slowed(text) from public, anon, authenticated;

create or replace function owner_set_genius_pace(p_pace text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_owner() then raise exception 'Only the owner can change this.'; end if;
  if p_pace not in ('normal', 'max') then raise exception 'Unknown pace.'; end if;
  if p_pace = 'max' and coalesce((select value from sc_private_settings where key = 'deezer_turbo'), 'off') = 'extreme' then
    raise exception 'Deezer is on extreme. Only one can go flat out at a time: set Deezer back first.';
  end if;
  if p_pace = 'max' then
    perform sc_set_genius_pace('max', null);
    insert into sc_private_settings (key, value) values
      ('site_paused', 'on'), ('genius_extreme_until', (now() + interval '3 hours')::text)
    on conflict (key) do update set value = excluded.value;
  else
    perform sc_genius_extreme_end(null);
  end if;
end;
$$;
revoke execute on function owner_set_genius_pace(text) from public, anon;
grant execute on function owner_set_genius_pace(text) to authenticated;

create or replace function owner_genius()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_owner() then jsonb_build_object(
    'pace', case (select value from sc_private_settings where key = 'genius_pace') when 'max' then 'max' else 'normal' end,
    'until', (select value from sc_private_settings where key = 'genius_extreme_until'),
    'note', nullif((select value from sc_private_settings where key = 'genius_pace_note'), ''),
    'paused_until', (select value from sc_private_settings where key = 'genius_pause_until'),
    'unchecked', (select count(*) from tracks where genius_checked_at is null),
    'checked_last_hour', (select count(*) from tracks where genius_checked_at > now() - interval '1 hour'),
    'calls_last_hour', (select coalesce(sum(calls), 0) from api_budget where service = 'genius' and minute > now() - interval '1 hour')
  ) end;
$$;
revoke execute on function owner_genius() from public, anon;
grant execute on function owner_genius() to authenticated;

-- Is the site paused, which job is running and until when.
create or replace function rpc_site_paused()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'paused', coalesce((select value from sc_private_settings where key = 'site_paused'), 'off') = 'on',
    'job', case when (select value from sc_private_settings where key = 'genius_pace') = 'max' then 'Genius' else 'Deezer' end,
    'until', case when (select value from sc_private_settings where key = 'genius_pace') = 'max'
                  then (select value from sc_private_settings where key = 'genius_extreme_until')
                  else (select value from sc_private_settings where key = 'deezer_extreme_until') end,
    'owner', is_owner());
$$;
grant execute on function rpc_site_paused() to anon, authenticated;

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
