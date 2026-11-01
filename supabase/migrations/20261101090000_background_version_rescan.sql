-- Sub-versions "rescan" stopped with "statement timeout": Kanye alone now
-- takes ~12 s to scan (13,000+ songs), over the 8 s limit for signed-in
-- requests. The button now asks for a rescan; a background job (no time
-- limit) does it within two minutes and saves the result for the page.

create or replace function admin_request_version_scan()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  insert into home_cache (key, data, refreshed_at)
  values ('version_rescan', jsonb_build_object('requested_at', now(), 'state', 'waiting'), now())
  on conflict (key) do update
    set data = home_cache.data || jsonb_build_object('requested_at', now(), 'state', 'waiting'), refreshed_at = now();
  return (select data from home_cache where key = 'version_rescan');
end;
$$;

create or replace function admin_version_scan_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  return coalesce((select data from home_cache where key = 'version_rescan'), '{}'::jsonb);
end;
$$;

-- Background: runs a requested rescan, one artist at a time.
create or replace function sc_version_rescan_run()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_req jsonb := (select data from home_cache where key = 'version_rescan');
  v_artist text;
  v_n int := 0;
  v_ids uuid[];
begin
  if v_req is null or v_req ->> 'state' <> 'waiting' then return -1; end if;
  update home_cache set data = data || jsonb_build_object('state', 'running', 'started_at', clock_timestamp()) where key = 'version_rescan';
  for v_artist in select id from artists order by id loop
    v_n := v_n + coalesce(sc_scan_versions(array[v_artist]), 0);
  end loop;
  -- Clear ones are linked straight away (undoable), as before.
  select array_agg(vs.id) into v_ids
  from version_suggestions vs
  where vs.state = 'open' and vs.cls = 'sure' and vs.action = 'link';
  if v_ids is not null then
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('sub_versions', 'Sub-versions: clear ones linked after a rescan');
    perform sc_apply_version_suggestions(v_ids);
  end if;
  update home_cache
  set data = data || jsonb_build_object('state', 'done', 'done_at', clock_timestamp(), 'added', v_n, 'linked', coalesce(cardinality(v_ids), 0)),
      refreshed_at = now()
  where key = 'version_rescan';
  return v_n;
end;
$$;

revoke execute on function sc_version_rescan_run() from public, anon, authenticated;
revoke execute on function admin_request_version_scan(), admin_version_scan_status() from public, anon;
grant execute on function admin_request_version_scan(), admin_version_scan_status() to authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'version-rescan';
select cron.schedule('version-rescan', '*/2 * * * *', 'select sc_version_rescan_run()');
