-- Admin polish:
--   1. Health page: every timer with its schedule, last run and recent
--      failures (admin_timers).
--   2. Admin alerts in notifications: new takedown requests (admin), hidden
--      comments waiting for review (admin and moderators), and background
--      calls that failed in the last hour (admin; checked hourly).
--   3. Old "possible links" that point at lyrics sites, socials and news
--      (leftovers from the old Brave link finder) are cleared. It's one
--      entry in the undo history.

-- 1. Timers ------------------------------------------------------------------

create or replace function admin_timers()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'cron'
as $$
  select case when is_admin() then (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
      'last_run', (select max(d.start_time) from cron.job_run_details d where d.jobid = j.jobid),
      'last_status', (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1),
      'failed_24h', (select count(*) from cron.job_run_details d where d.jobid = j.jobid
                     and d.status <> 'succeeded' and d.start_time > now() - interval '24 hours'))
      order by j.jobname), '[]'::jsonb)
    from cron.job j) end;
$$;

create or replace function admin_background_failures()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'net'
as $$
  select case when is_admin() then jsonb_build_object(
    'calls_6h', (select count(*) from net._http_response where created > now() - interval '6 hours'),
    'failed_6h', (select count(*) from net._http_response
                  where created > now() - interval '6 hours' and (timed_out or status_code >= 400 or error_msg is not null)),
    'last_error', (select left(coalesce(error_msg, content::text, ''), 200) from net._http_response
                   where timed_out or status_code >= 400 or error_msg is not null order by created desc limit 1))
  end;
$$;

revoke execute on function admin_timers(), admin_background_failures() from public, anon;
grant execute on function admin_timers(), admin_background_failures() to authenticated;

-- 2. Admin alerts --------------------------------------------------------------

create or replace function sc_admin_ids(p_include_mods boolean default false)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select id from auth.users where email = 'dg.theswingingman@gmail.com'
  union
  select user_id from moderators where p_include_mods;
$$;

create or replace function takedown_requests_alert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into notifications (user_id, kind, title, body, link, dedupe_key)
  select a, 'admin', 'New takedown request',
         left(coalesce((select title from tracks where id = new.track_id), 'A song') || ': ' || coalesce(new.reason, ''), 200),
         '/review/takedowns', 'takedown:' || new.id
  from sc_admin_ids(false) a
  on conflict do nothing;
  return null;
end;
$$;
drop trigger if exists takedown_requests_alert on takedown_requests;
create trigger takedown_requests_alert after insert on takedown_requests
for each row execute function takedown_requests_alert();

create or replace function comments_hidden_alert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.hidden_at is not null and old.hidden_at is null then
    insert into notifications (user_id, kind, title, body, link, dedupe_key)
    select a, 'admin', 'A comment was hidden after reports', left(new.body, 160), '/review/comments', 'hidden:' || new.id
    from sc_admin_ids(true) a
    on conflict do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists comments_hidden_alert on comments;
create trigger comments_hidden_alert after update of hidden_at on comments
for each row execute function comments_hidden_alert();

-- Hourly: tell the admin if background calls failed.
create or replace function sc_background_check()
returns int
language plpgsql
security definer
set search_path to 'public', 'net'
as $$
declare
  v_failed int;
  v_err text;
begin
  select count(*), left(max(coalesce(error_msg, content::text, '')), 200) into v_failed, v_err
  from net._http_response
  where created > now() - interval '1 hour' and (timed_out or status_code >= 400 or error_msg is not null);
  if v_failed > 0 then
    insert into notifications (user_id, kind, title, body, link, dedupe_key)
    select a, 'admin', v_failed || ' background job call' || case when v_failed = 1 then '' else 's' end || ' failed in the last hour',
           v_err, '/admin/health', 'bg:' || to_char(now(), 'YYYY-MM-DD HH24')
    from sc_admin_ids(false) a
    on conflict do nothing;
  end if;
  return v_failed;
end;
$$;

revoke execute on function sc_admin_ids(boolean), takedown_requests_alert(), comments_hidden_alert(), sc_background_check()
  from public, anon, authenticated;

select cron.unschedule('background-check') where exists (select 1 from cron.job where jobname = 'background-check');
select cron.schedule('background-check', '55 * * * *', $job$ select public.sc_background_check(); $job$);

-- 3. Old possible links --------------------------------------------------------

do $$
begin
  perform set_config('request.jwt.claims', '{"email":"dg.theswingingman@gmail.com","role":"authenticated"}', true);
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('tidy', 'Old possible links (lyrics sites, socials) cleared');
  delete from track_link_candidates c
  where c.source_domain !~* '(^|\.)(soundcloud\.com|youtube\.com|youtu\.be|bandcamp\.com|spotify\.com|music\.apple\.com|deezer\.com|tidal\.com|audiomack\.com)$'
    and not exists (select 1 from track_link_candidate_votes v where v.candidate_id = c.id);
end $$;

select (select count(*) from track_link_candidates) possible_links_left;
