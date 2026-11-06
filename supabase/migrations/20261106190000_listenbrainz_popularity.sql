-- Play counts from ListenBrainz (open data). The listenbrainz-sync job reads
-- each artist's top recordings (artists with a MusicBrainz id), matches them to
-- the artist's main songs by title and saves listens / listeners. Songs with no
-- cover get a Cover Art Archive cover from the same answer.
create table if not exists track_popularity (
  track_id text primary key references tracks(id) on delete cascade,
  listens bigint not null default 0,
  listeners int not null default 0,
  recording_mbid text,
  updated_at timestamptz not null default now()
);
alter table track_popularity enable row level security;
drop policy if exists track_popularity_read on track_popularity;
create policy track_popularity_read on track_popularity for select using (true);

alter table artists add column if not exists lb_checked_at timestamptz, add column if not exists lb_claim_at timestamptz;

insert into sc_private_settings (key, value) values ('listenbrainz_per_minute', '20'), ('listenbrainz_per_day', '3000')
on conflict (key) do nothing;

create or replace function sc_lb_next(p_secret text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_id text; v_mbid text;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  select a.id, a.musicbrainz_id into v_id, v_mbid from artists a left join sc_artist_weights() w on w.artist_id = a.id
  where a.musicbrainz_id is not null
    and (a.lb_checked_at is null or a.lb_checked_at < now() - interval '14 days')
    and (a.lb_claim_at is null or a.lb_claim_at < now() - interval '5 minutes')
  order by a.lb_checked_at nulls first, coalesce(w.weight, 0) desc, a.id
  limit 1 for update of a skip locked;
  if v_id is null then return null; end if;
  update artists set lb_claim_at = now() where id = v_id;
  return jsonb_build_object('artist_id', v_id, 'mbid', v_mbid);
end $function$;

create or replace function sc_lb_save(p_secret text, p_artist text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; c int := 0;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  -- ListenBrainz failed for this artist: try again in a day.
  if p_items is null then
    update artists set lb_checked_at = now() - interval '13 days', lb_claim_at = null where id = p_artist;
    return jsonb_build_object('matched', 0, 'covers', 0, 'retry', true);
  end if;
  -- Match each recording to this artist's main song with the same title.
  create temp table _lb on commit drop as
  select distinct on (t.id) t.id track_id, (x ->> 'total_listen_count')::bigint listens, coalesce((x ->> 'total_user_count')::int, 0) listeners,
         x ->> 'recording_mbid' mbid, x ->> 'caa_release_mbid' caa_rel, x ->> 'caa_id' caa_id
  from jsonb_array_elements(coalesce(p_items, '[]')) x
  join tracks t on t.artist_id = p_artist and t.parent_track_id is null
               and sc_title_key(t.title) = sc_title_key(x ->> 'recording_name')
  where coalesce((x ->> 'total_listen_count')::bigint, 0) > 0
  order by t.id, (x ->> 'total_listen_count')::bigint desc;
  insert into track_popularity (track_id, listens, listeners, recording_mbid, updated_at)
  select track_id, listens, listeners, mbid, now() from _lb
  on conflict (track_id) do update set listens = excluded.listens, listeners = excluded.listeners, recording_mbid = excluded.recording_mbid, updated_at = now();
  get diagnostics n = row_count;
  update tracks t set cover_url = 'https://coverartarchive.org/release/' || l.caa_rel || '/' || l.caa_id || '-500.jpg'
  from _lb l where t.id = l.track_id and t.cover_url is null and l.caa_rel ~ '^[0-9a-f-]{36}$' and l.caa_id ~ '^[0-9]+$';
  get diagnostics c = row_count;
  update artists set lb_checked_at = now(), lb_claim_at = null where id = p_artist;
  return jsonb_build_object('matched', n, 'covers', c);
end $function$;
revoke execute on function sc_lb_next(text), sc_lb_save(text, text, jsonb) from public, anon, authenticated;

-- Every 5 minutes (the job waits until the LISTENBRAINZ_TOKEN secret is set).
select cron.schedule('listenbrainz-sync', '*/5 * * * *', $$ select net.http_post(url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.sc_private_settings where key='cron_secret')), body := jsonb_build_object('fn','listenbrainz-sync','body','{}'::jsonb), timeout_milliseconds := 15000); $$);
