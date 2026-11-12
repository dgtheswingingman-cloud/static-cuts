-- Sorting out unconfirmed songs faster:
-- 1. Launch clean-up: tick songs and mark them released / leaked / snippet,
--    or remove ones that aren't real songs (undoable, quietly: no alerts).
-- 2. ChatGPT routines: the owner's and moderators' routines (read-only, so
--    checked directly, not through is_moderator) get the launch artists first in
--    the catalogue backlog, and leaks missing a date or album count as
--    needing details; suggest_details can now send a leak date.

create or replace function admin_launch_triage(p_ids text[], p_action text) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_action in ('released', 'leaked', 'snippet') then
    perform sc_begin_batch('launch-cleanup', 'Launch clean-up: marked ' || cardinality(p_ids) || ' unconfirmed songs ' || p_action);
    perform set_config('static_cuts.skip_status_log', 'on', true);
    update tracks set release_status = p_action where id = any (p_ids) and release_status = 'unconfirmed' and parent_track_id is null;
    get diagnostics n = row_count;
    perform set_config('static_cuts.skip_status_log', '', true);
    return n;
  elsif p_action = 'remove' then
    perform sc_begin_batch('launch-cleanup', 'Launch clean-up: removed ' || cardinality(p_ids) || ' entries that weren''t real songs');
    delete from tracks where id = any (p_ids) and release_status = 'unconfirmed' and parent_track_id is null;
    get diagnostics n = row_count;
    return n;
  end if;
  raise exception 'unknown action';
end $$;
revoke execute on function admin_launch_triage(text[], text) from public, anon;
grant execute on function admin_launch_triage(text[], text) to authenticated;

-- Leaks and snippets missing a leak date or album need details too.
create or replace function public.sc_track_needs(t tracks) returns text[]
language sql stable parallel safe as $function$
  select array_remove(array[
    case when t.parent_track_id is null and coalesce(t.release_status, 'unconfirmed') = 'unconfirmed' then 'status' end,
    case when t.spotify_url is null then 'link' end,
    case when t.parent_track_id is null and (
          (t.release_status = 'released' and (t.album is null or t.release_date is null or t.producers is null))
       or (t.release_status in ('leaked', 'snippet') and (nullif(trim(t.album), '') is null or (t.release_status = 'leaked' and t.leak_date is null)))
         ) then 'details' end,
    case when t.parent_track_id is null and t.release_status in ('leaked', 'snippet')
          and t.cover_url is null and t.fan_cover_url is null then 'cover' end
  ], null)
$function$;

do $d$
declare src text; n text;
begin
  -- suggest_details: a leak date
  src := pg_get_functiondef('public.rpc_suggest_details(jsonb)'::regprocedure);
  if position('leak_date' in src) = 0 then
    n := replace(src, $q$  if v = '{}'::jsonb then$q$, $q$  if (p ->> 'leak_date') ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_date := (p ->> 'leak_date')::date;
      if extract(year from v_date) between 1990 and 2100 and v_date <= current_date
         and (t.leak_date is null or (v_replace and t.leak_date <> v_date)) then
        v := v || jsonb_build_object('leak_date', v_date::text); was := was || jsonb_build_object('leak_date', t.leak_date);
      end if;
    exception when others then null;
    end;
  end if;

  if v = '{}'::jsonb then$q$);
    if n = src then raise exception 'rpc_suggest_details not patched'; end if;
    execute n;
  end if;

  -- approving a correction applies the leak date
  src := pg_get_functiondef('public.approve_submission(uuid, text[], text)'::regprocedure);
  if position('leak_date' in src) = 0 then
    n := replace(src, $q$release_date = case when 'release_date' = any(p_excluded_fields) then release_date$q$,
      $q$leak_date = case when 'leak_date' = any(p_excluded_fields) then leak_date
        when sub.payload ? 'leak_date' and sub.payload->>'leak_date' <> '' then (sub.payload->>'leak_date')::date else leak_date end,
      release_date = case when 'release_date' = any(p_excluded_fields) then release_date$q$);
    if n = src then raise exception 'approve_submission not patched'; end if;
    execute n;
  end if;

  -- routines: moderators also get the launch artists, first
  src := pg_get_functiondef('public.rpc_catalogue_backlog(text, text, integer, integer)'::regprocedure);
  if position('launch_artists' in src) = 0 then
    n := replace(src, $q$v_artists := array(select f.artist_id from follows f where f.user_id = uid);$q$,
      $q$v_artists := array(select f.artist_id from follows f where f.user_id = uid
                         union select l.artist_id from launch_artists l
                         where exists (select 1 from moderators m where m.user_id = uid)
                            or exists (select 1 from auth.users u where u.id = uid and u.email = 'dg.theswingingman@gmail.com'));$q$);
    n := replace(n, $q$order by t.routine_checked_at nulls first,$q$,
      $q$order by exists (select 1 from launch_artists l where l.artist_id = t.artist_id) desc, t.routine_checked_at nulls first,$q$);
    if n = src or position('launch_artists l where l.artist_id = t.artist_id' in n) = 0 then raise exception 'rpc_catalogue_backlog not patched'; end if;
    execute n;
  end if;
end $d$;
