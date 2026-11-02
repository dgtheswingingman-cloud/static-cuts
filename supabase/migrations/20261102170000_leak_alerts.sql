-- Leak alerts for followed artists, per artist: instant, daily round-up
-- (the existing morning summary) or off. New follows start on daily.
--
-- Instant fires for: a song leaking or getting snippeted, an unreleased song
-- coming out officially, a new leaked/snippeted song being added, or a new
-- release (released in the last week). Bulk changes (a tracker sync, the
-- catalogue being filled in) can't flood anyone: at most 5 instant alerts
-- per artist per hour each; the rest show in the next morning's summary.

alter table follows add column if not exists alert text not null default 'daily' check (alert in ('instant', 'daily', 'off'));

create or replace function sc_instant_alert(p_track text, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare t record;
begin
  select tr.id, tr.title, tr.artist_id, a.name artist into t
  from tracks tr join artists a on a.id = tr.artist_id where tr.id = p_track and tr.parent_track_id is null;
  if t.id is null then return; end if;
  insert into notifications (user_id, kind, title, body, link, track_id, dedupe_key)
  select f.user_id, 'alert', p_title, p_body, '/song/' || t.id, t.id, 'alert:' || t.id || ':' || p_title
  from follows f
  where f.artist_id = t.artist_id and f.alert = 'instant'
    and (select count(*) from notifications n
         where n.user_id = f.user_id and n.kind = 'alert' and n.created_at > now() - interval '1 hour'
           and n.track_id in (select id from tracks where artist_id = t.artist_id)) < 5
  on conflict do nothing;
end;
$$;
revoke execute on function sc_instant_alert(text, text, text) from public, anon, authenticated;

-- Status changes.
create or replace function sc_alert_on_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare t record;
begin
  if new.to_status is not distinct from new.from_status then return null; end if;
  select tr.title, a.name artist into t from tracks tr join artists a on a.id = tr.artist_id where tr.id = new.track_id;
  if t.title is null then return null; end if;
  if new.to_status = 'leaked' then
    perform sc_instant_alert(new.track_id, t.artist || ' · ' || t.title || ' leaked', null);
  elsif new.to_status = 'snippet' then
    perform sc_instant_alert(new.track_id, 'New ' || t.artist || ' snippet: ' || t.title, null);
  elsif new.to_status = 'released' and coalesce(new.from_status, 'unconfirmed') <> 'unconfirmed' then
    perform sc_instant_alert(new.track_id, t.artist || ' · ' || t.title || ' is out now', 'Was ' || new.from_status || '.');
  end if;
  return null;
end;
$$;
create trigger track_status_alert after insert on track_status_events
  for each row execute function sc_alert_on_status();

-- New songs.
create or replace function sc_alert_on_new_track()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_artist text;
begin
  if new.parent_track_id is not null then return null; end if;
  if not (new.release_status in ('leaked', 'snippet') or (new.release_status = 'released' and new.release_date >= current_date - 7)) then
    return null;
  end if;
  select name into v_artist from artists where id = new.artist_id;
  if new.release_status = 'leaked' then
    perform sc_instant_alert(new.id, 'New ' || v_artist || ' leak: ' || new.title, null);
  elsif new.release_status = 'snippet' then
    perform sc_instant_alert(new.id, 'New ' || v_artist || ' snippet: ' || new.title, null);
  elsif new.release_status = 'released' and new.release_date >= current_date - 7 then
    perform sc_instant_alert(new.id, 'New ' || v_artist || ' release: ' || new.title, null);
  end if;
  return null;
end;
$$;
create trigger track_new_alert after insert on tracks
  for each row execute function sc_alert_on_new_track();

-- The morning summary covers artists set to daily (instant ones are already
-- covered as they happen; off is off).
do $do$
declare d text := pg_get_functiondef('sc_follow_digest()'::regprocedure);
begin
  if position('f.alert' in d) = 0 then
    if position('join profiles p on p.id = f.user_id and p.notify_followed_daily' in d) = 0 then raise exception 'sc_follow_digest: anchor not found'; end if;
    d := replace(d, 'join profiles p on p.id = f.user_id and p.notify_followed_daily',
                    'join profiles p on p.id = f.user_id and p.notify_followed_daily and f.alert = ''daily''');
    execute d;
  end if;
end;
$do$;

-- Set the alert for an artist you follow.
create or replace function rpc_set_follow_alert(p_artist text, p_alert text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_alert not in ('instant', 'daily', 'off') then raise exception 'unknown setting'; end if;
  update follows set alert = p_alert where user_id = auth.uid() and artist_id = p_artist;
end;
$$;
grant execute on function rpc_set_follow_alert(text, text) to authenticated;
