-- Deezer flat out: an owner switch (Control room → Owner → Deezer). Normal:
-- up to 60 calls every 2 minutes (~30 a minute). Flat out: the timer runs
-- every minute and keeps going for 50 seconds (~100+ calls a minute; Deezer
-- allows about 600). The allowance is raised to fit; normal mode still only
-- uses what it did.

insert into sc_private_settings (key, value) values ('deezer_turbo', 'off') on conflict (key) do nothing;
update sc_private_settings set value = '200' where key = 'deezer_per_minute';
update sc_private_settings set value = '250000' where key = 'deezer_per_day';

create or replace function owner_deezer()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_owner() then jsonb_build_object(
    'turbo', coalesce((select value from sc_private_settings where key = 'deezer_turbo'), 'off') = 'on',
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

create or replace function owner_set_deezer_turbo(p_on boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_owner() then raise exception 'Only the owner can change this.'; end if;
  insert into sc_private_settings (key, value) values ('deezer_turbo', case when p_on then 'on' else 'off' end)
  on conflict (key) do update set value = excluded.value;
end;
$$;
revoke execute on function owner_set_deezer_turbo(boolean) from public, anon;
grant execute on function owner_set_deezer_turbo(boolean) to authenticated;

-- Every minute; in normal mode the job skips every other minute.
select cron.schedule('deezer-sync', '* * * * *', $cron$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/deezer-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$cron$);
