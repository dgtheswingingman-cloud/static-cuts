-- Track Watch: "watch" a song (radar_watches, the old "remind me").
-- Free: a notification when its status changes (snippet → leaked → released).
-- Premium extras on watched songs: a new version added, a new possible link
-- found, and a release / leak date filled in. One of each per song per day.

create or replace function sc_watch_notify(p_track text, p_kind text, p_title text, p_body text) returns void
language sql security definer set search_path to 'public' as $$
  insert into notifications (user_id, kind, title, body, link, track_id, dedupe_key)
  select w.user_id, 'status', p_title, p_body, '/song/' || p_track, p_track,
         'watch:' || p_kind || ':' || p_track || ':' || (now() at time zone 'Europe/London')::date
  from radar_watches w where w.track_id = p_track and is_premium(w.user_id)
  on conflict do nothing;
$$;

create or replace function sc_watch_on_version() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare p record;
begin
  if new.parent_track_id is null then return null; end if;
  select t.id, t.title, a.name artist into p from tracks t join artists a on a.id = t.artist_id where t.id = new.parent_track_id;
  if p.id is null or not exists (select 1 from radar_watches where track_id = p.id) then return null; end if;
  perform sc_watch_notify(p.id, 'version', p.artist || ' · ' || p.title || ': new version', new.title);
  return null;
end $$;
drop trigger if exists tracks_watch_version on tracks;
create trigger tracks_watch_version after insert or update of parent_track_id on tracks
  for each row when (new.parent_track_id is not null) execute function sc_watch_on_version();

create or replace function sc_watch_on_dates() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare a text;
begin
  if not exists (select 1 from radar_watches where track_id = new.id) then return null; end if;
  select name into a from artists where id = new.artist_id;
  if old.leak_date is null and new.leak_date is not null then
    perform sc_watch_notify(new.id, 'leak_date', a || ' · ' || new.title || ': leak date added', 'Leaked ' || to_char(new.leak_date, 'FMDD Mon YYYY') || '.');
  end if;
  if old.release_date is distinct from new.release_date and new.release_date is not null then
    perform sc_watch_notify(new.id, 'release_date', a || ' · ' || new.title || ': release date ' || case when old.release_date is null then 'added' else 'changed' end,
      'Out ' || to_char(new.release_date, 'FMDD Mon YYYY') || '.');
  end if;
  return null;
end $$;
drop trigger if exists tracks_watch_dates on tracks;
create trigger tracks_watch_dates after update of leak_date, release_date on tracks
  for each row when (old.leak_date is distinct from new.leak_date or old.release_date is distinct from new.release_date)
  execute function sc_watch_on_dates();

create or replace function sc_watch_on_link() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare p record;
begin
  if new.track_id is null or not exists (select 1 from radar_watches where track_id = new.track_id) then return null; end if;
  select t.id, t.title, a.name artist into p from tracks t join artists a on a.id = t.artist_id where t.id = new.track_id;
  perform sc_watch_notify(p.id, 'link', p.artist || ' · ' || p.title || ': new link found',
    'A possible link on ' || coalesce(new.source_domain, 'the web') || ', waiting for votes.');
  return null;
end $$;
drop trigger if exists link_candidates_watch on track_link_candidates;
create trigger link_candidates_watch after insert on track_link_candidates
  for each row execute function sc_watch_on_link();

-- My Library: the songs you're watching.
create or replace function rpc_my_watches() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'artist', a.name, 'artist_id', a.id,
      'status', t.release_status, 'cover', coalesce(t.cover_url, t.fan_cover_url), 'since', w.created_at) order by w.created_at desc), '[]')
  from radar_watches w join tracks t on t.id = w.track_id join artists a on a.id = t.artist_id
  where w.user_id = auth.uid();
$$;
revoke execute on function rpc_my_watches() from public, anon;
grant execute on function rpc_my_watches() to authenticated;
revoke execute on function sc_watch_notify(text, text, text, text) from public, anon, authenticated;
