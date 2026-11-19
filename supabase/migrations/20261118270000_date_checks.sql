-- Dates that break the archive's rules.
--
-- 1. Store pre-releases. Deezer lists albums before release day, so their
--    songs came in "released" with a date in the future. An hourly job holds
--    those as "announced" (quietly: no status event) and puts them back to
--    "released" on the day (logged, so it shows on the radar as a release).
--    It only ever flips back songs it held itself (prerelease_holds), never
--    an announcement someone set by hand.
-- 2. Date checks for admins, only where nothing is lost:
--    copied  unreleased song whose release date is just a copy of its leak
--            date: clear the release date.
--    noleak  leaked song whose only date is in "release date": move it to
--            the leak date.
--    linked  "unreleased" song with a Spotify track link: maybe released.
--    Other unreleased songs with a release date (mostly trackers' recording
--    dates, which have nowhere else to go) are left alone.

create table if not exists prerelease_holds (
  track_id text primary key references tracks(id) on delete cascade,
  held_at timestamptz not null default now()
);
alter table prerelease_holds enable row level security;
revoke all on table prerelease_holds from anon, authenticated;

create or replace function sc_prerelease_step()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare held int; released int; today date := (now() at time zone 'utc')::date;
begin
  -- Out today (or before): back to released, logged as a status change.
  with due as (
    delete from prerelease_holds h using tracks t
    where t.id = h.track_id and t.release_date <= today
    returning t.id, t.release_status)
  update tracks t set release_status = 'released'
  from due where t.id = due.id and due.release_status = 'announced';
  get diagnostics released = row_count;
  -- Holds whose song was changed by someone else (or lost its date): dropped.
  delete from prerelease_holds h using tracks t
  where t.id = h.track_id and (t.release_status <> 'announced' or t.release_date is null);

  -- New pre-releases: held as announced, without a status event.
  perform set_config('static_cuts.skip_status_log', 'on', true);
  with fut as (
    update tracks set release_status = 'announced'
    where release_status = 'released' and release_date > today
    returning id)
  insert into prerelease_holds (track_id) select id from fut on conflict do nothing;
  get diagnostics held = row_count;
  perform set_config('static_cuts.skip_status_log', '', true);
  return jsonb_build_object('held', held, 'released', released);
end $$;
revoke execute on function sc_prerelease_step() from public, anon, authenticated;
-- Scheduled hourly once the owner has seen the first run (see 20261118280000).

-- Dismissed date checks share the title checks' table.
alter table title_check_dismissed drop constraint if exists title_check_dismissed_kind_check;
alter table title_check_dismissed add constraint title_check_dismissed_kind_check
  check (kind in ('cut', 'garbled', 'copied', 'noleak', 'linked'));

create or replace function admin_date_checks()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  with rows as (
    select case
             when t.release_status in ('leaked', 'snippet', 'teased', 'rumored') and t.spotify_url ~ 'open\.spotify\.com/track/' then 'linked'
             when t.release_status in ('leaked', 'snippet', 'teased', 'rumored') and t.release_date = t.leak_date then 'copied'
             when t.release_status = 'leaked' and t.leak_date is null and t.release_date is not null then 'noleak'
           end kind,
           t.id, t.title, t.artist_id, a.name artist, t.release_status status, t.release_date, t.leak_date, t.spotify_url
    from tracks t join artists a on a.id = t.artist_id
    where t.release_status in ('leaked', 'snippet', 'teased', 'rumored')
      and (t.release_date is not null or t.spotify_url ~ 'open\.spotify\.com/track/'))
  select case when not is_admin() then null else jsonb_build_object(
    'copied', coalesce((select jsonb_agg(to_jsonb(r) - 'kind' order by r.artist, r.title) from rows r where r.kind = 'copied'
                        and not exists (select 1 from title_check_dismissed d where d.track_id = r.id and d.kind = 'copied')), '[]'::jsonb),
    'noleak', coalesce((select jsonb_agg(to_jsonb(r) - 'kind' order by r.artist, r.title) from rows r where r.kind = 'noleak'
                        and not exists (select 1 from title_check_dismissed d where d.track_id = r.id and d.kind = 'noleak')), '[]'::jsonb),
    'linked', coalesce((select jsonb_agg(to_jsonb(r) - 'kind' order by r.artist, r.title) from rows r where r.kind = 'linked'
                        and not exists (select 1 from title_check_dismissed d where d.track_id = r.id and d.kind = 'linked')), '[]'::jsonb),
    'held', (select count(*) from prerelease_holds)) end;
$$;

-- One song, or every listed song of a kind when p_track is null ('all').
create or replace function admin_date_check_action(p_kind text, p_action text, p_track text default null)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare n int := 0; ids text[];
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_kind not in ('copied', 'noleak', 'linked') then raise exception 'unknown check'; end if;
  if p_action = 'dismiss' then
    if p_track is null then raise exception 'dismiss one at a time'; end if;
    insert into title_check_dismissed (track_id, kind) values (p_track, p_kind) on conflict do nothing;
    return 1;
  end if;
  -- The songs this applies to, rechecked now (the list may be stale).
  select array_agg(t.id) into ids from tracks t
  where (p_track is null or t.id = p_track)
    and not exists (select 1 from title_check_dismissed d where d.track_id = t.id and d.kind = p_kind)
    and case p_kind
      when 'copied' then t.release_status in ('leaked', 'snippet', 'teased', 'rumored') and t.release_date = t.leak_date
                         and coalesce(t.spotify_url, '') !~ 'open\.spotify\.com/track/'
      when 'noleak' then t.release_status = 'leaked' and t.leak_date is null and t.release_date is not null
                         and coalesce(t.spotify_url, '') !~ 'open\.spotify\.com/track/'
      when 'linked' then t.release_status in ('leaked', 'snippet', 'teased', 'rumored') and t.spotify_url ~ 'open\.spotify\.com/track/'
    end;
  if ids is null then return 0; end if;
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('dates', case p_kind
    when 'copied' then 'Copied release date cleared'
    when 'noleak' then 'Release date moved to leak date'
    else 'Marked released (had a Spotify link)' end || case when p_track is null then ' (all)' else '' end);
  if p_kind = 'copied' and p_action = 'clear' then
    update tracks set release_date = null where id = any (ids);
  elsif p_kind = 'noleak' and p_action = 'move' then
    update tracks set leak_date = release_date, release_date = null where id = any (ids);
  elsif p_kind = 'linked' and p_action = 'released' then
    if p_track is null then raise exception 'mark released one at a time'; end if;
    update tracks set release_status = 'released' where id = any (ids);
  else
    raise exception 'unknown action';
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function admin_date_checks() from public, anon;
revoke execute on function admin_date_check_action(text, text, text) from public, anon;
grant execute on function admin_date_checks() to authenticated;
grant execute on function admin_date_check_action(text, text, text) to authenticated;
