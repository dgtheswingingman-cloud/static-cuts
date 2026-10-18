-- Sheet re-checks on the same footing as the Genius timer, instead of every
-- night.
--
-- Each sheet is re-read a week after its last check. Quiet sheets back off:
-- no new songs once -> 2 weeks, twice or more -> a month. A check that finds
-- new songs resets it to weekly. The timer runs hourly and checks at most one
-- due sheet each time; sheets for artists people are asking about (follows
-- and requests) go first.

alter table sheet_sources add column if not exists next_check_at timestamptz;
alter table sheet_sources add column if not exists quiet_streak int not null default 0;
update sheet_sources set next_check_at = coalesce(last_synced_at, now()) + interval '7 days' where next_check_at is null;

create or replace function sc_sheet_wait(p_streak int)
returns interval
language sql
immutable
as $$
  select case when coalesce(p_streak, 0) <= 0 then interval '7 days'
              when p_streak = 1 then interval '14 days'
              else interval '30 days' end;
$$;

-- After each import or re-check: set when it's next due.
create or replace function sheet_sources_schedule()
returns trigger
language plpgsql
as $$
begin
  if new.last_synced_at is distinct from old.last_synced_at then
    if new.last_result ? 'error' then
      new.next_check_at := now() + interval '1 day';
    elsif coalesce((new.last_result ->> 'suggested')::int, 0) > 0 then
      new.quiet_streak := 0;
      new.next_check_at := now() + sc_sheet_wait(0);
    else
      new.quiet_streak := old.quiet_streak + 1;
      new.next_check_at := now() + sc_sheet_wait(new.quiet_streak);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists sheet_sources_schedule on sheet_sources;
create trigger sheet_sources_schedule before update of last_synced_at on sheet_sources
for each row execute function sheet_sources_schedule();

create or replace function sheet_sources_first_schedule()
returns trigger
language plpgsql
as $$
begin
  new.next_check_at := coalesce(new.next_check_at, now() + interval '7 days');
  return new;
end;
$$;
drop trigger if exists sheet_sources_first_schedule on sheet_sources;
create trigger sheet_sources_first_schedule before insert on sheet_sources
for each row execute function sheet_sources_first_schedule();

-- One due sheet per run, busiest artists first.
create or replace function sc_sheet_sync_due(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'user_id', (select id from auth.users where email = 'dg.theswingingman@gmail.com'),
    'sources', (select coalesce(jsonb_agg(id), '[]'::jsonb) from (
      select s.id from sheet_sources s
      where s.auto_sync and coalesce(s.next_check_at, now()) <= now()
        and (s.last_synced_at is null or s.last_synced_at < now() - interval '1 day')
      order by (select count(*) from follows f where f.artist_id = s.artist_id)
             + (select count(*) from artist_requests r where r.artist_id = s.artist_id and r.created_at > now() - interval '30 days') desc,
               s.next_check_at nulls first
      limit 1) x));
end;
$$;

-- Moderators' list shows when each sheet is next checked.
drop function if exists rpc_sheet_sources();
create or replace function rpc_sheet_sources()
returns table (id uuid, title text, tab_name text, credit text, url text, artist_id text, artist text,
               songs bigint, created_at timestamptz, last_synced_at timestamptz, auto_sync boolean, next_check_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.id, s.title, s.tab_name, s.credit, s.url, s.artist_id, a.name,
         (select count(*) from tracks t where t.source = 'sheet' and t.source_url = s.url),
         s.created_at, s.last_synced_at, s.auto_sync, s.next_check_at
  from sheet_sources s join artists a on a.id = s.artist_id
  order by a.name, s.title;
$$;
grant execute on function rpc_sheet_sources() to anon, authenticated;
revoke execute on function sc_sheet_sync_due(text) from public, anon, authenticated;
grant execute on function sc_sheet_sync_due(text) to service_role;

-- Hourly instead of nightly (one sheet at most each time).
select cron.unschedule('sheet-sync') where exists (select 1 from cron.job where jobname = 'sheet-sync');
select cron.schedule('sheet-sync', '37 * * * *', $job$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/sheet-import',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 300000);
$job$);
