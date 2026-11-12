-- Covers from SoundCloud for songs whose listen link is on SoundCloud (old
-- uploads Deezer / Apple don't have). SoundCloud's public oEmbed gives the
-- track's artwork (500x500); a track with no art gives the uploader's
-- picture instead, which is skipped. Every 5 minutes: read the answers to
-- the last run's requests, then ask about 20 more. Only empty covers are
-- filled; each run that fills any is one undo-history batch.
-- Also: tracker re-checks now fill a song's empty listen link from the
-- tracker (new imports already did).

create table if not exists soundcloud_cover_checks (
  track_id text primary key references tracks(id) on delete cascade,
  request_id bigint,
  asked_at timestamptz not null default now(),
  done_at timestamptz,
  result text
);
alter table soundcloud_cover_checks enable row level security;

create or replace function sc_soundcloud_cover_step() returns jsonb
language plpgsql security definer set search_path to 'public' set statement_timeout to '60s' as $$
declare r record; v_art text; v_filled int := 0; v_batch boolean := false; v_asked int := 0;
begin
  -- 1. Answers to earlier requests.
  for r in select c.track_id, c.request_id, h.status_code, h.content
           from soundcloud_cover_checks c join net._http_response h on h.id = c.request_id
           where c.done_at is null loop
    v_art := null;
    if r.status_code = 200 then
      begin v_art := (r.content::jsonb) ->> 'thumbnail_url'; exception when others then v_art := null; end;
    end if;
    if v_art ~ '^https://i\d?\.sndcdn\.com/artworks-' then
      if not v_batch then perform sc_begin_batch('cover', 'Covers from SoundCloud'); v_batch := true; end if;
      update tracks set cover_url = v_art where id = r.track_id and cover_url is null;
      if found then v_filled := v_filled + 1; end if;
      update soundcloud_cover_checks set done_at = now(), result = 'cover' where track_id = r.track_id;
    else
      update soundcloud_cover_checks set done_at = now(),
        result = case when r.status_code = 200 then 'no art' else 'http ' || coalesce(r.status_code::text, '?') end
      where track_id = r.track_id;
    end if;
  end loop;
  -- Requests that never got an answer: try again later.
  delete from soundcloud_cover_checks where done_at is null and asked_at < now() - interval '1 hour';
  if v_batch then perform set_config('static_cuts.batch_id', '', true); end if;

  -- 2. The next 20.
  for r in select t.id, t.spotify_url from tracks t
           where t.parent_track_id is null and t.cover_url is null and t.fan_cover_url is null
             and t.spotify_url ~ '^https://(www\.|m\.)?soundcloud\.com/[^/?#]+/[^/?#]+'
             and not exists (select 1 from soundcloud_cover_checks c where c.track_id = t.id
                             and (c.done_at is null or c.done_at > now() - interval '180 days'))
           order by exists (select 1 from launch_artists l where l.artist_id = t.artist_id) desc, t.id
           limit 20 loop
    insert into soundcloud_cover_checks (track_id, request_id, asked_at)
    values (r.id, net.http_get('https://soundcloud.com/oembed?format=json&url=' || replace(replace(replace(replace(replace(replace(replace(r.spotify_url, '%', '%25'), ':', '%3A'), '/', '%2F'), '?', '%3F'), '&', '%26'), '#', '%23'), ' ', '%20'),
                               timeout_milliseconds := 10000), now())
    on conflict (track_id) do update set request_id = excluded.request_id, asked_at = now(), done_at = null, result = null;
    v_asked := v_asked + 1;
  end loop;
  return jsonb_build_object('filled', v_filled, 'asked', v_asked);
end $$;
revoke execute on function sc_soundcloud_cover_step() from public, anon, authenticated;

select cron.schedule('soundcloud-covers', '*/5 * * * *', $c$select public.sc_soundcloud_cover_step()$c$);

-- Tracker re-checks fill an empty listen link.
do $$
declare d text; o text;
begin
  o := pg_get_functiondef('sc_sheet_reconcile(uuid,text,jsonb)'::regprocedure);
  d := replace(o, E'      featured_artists = coalesce(featured_artists, nullif(it -> ''extra'' ->> ''featuring'', ''''))\r\n    where id = t.id\r\n',
                  E'      featured_artists = coalesce(featured_artists, nullif(it -> ''extra'' ->> ''featuring'', '''')),\r\n      spotify_url = coalesce(spotify_url, nullif(it -> ''extra'' ->> ''listen_url'', ''''))\r\n    where id = t.id\r\n');
  d := replace(d, E'        or (featured_artists is null and nullif(it -> ''extra'' ->> ''featuring'', '''') is not null));\r\n',
                  E'        or (featured_artists is null and nullif(it -> ''extra'' ->> ''featuring'', '''') is not null)\r\n        or (spotify_url is null and nullif(it -> ''extra'' ->> ''listen_url'', '''') is not null));\r\n');
  if d = o or position('spotify_url = coalesce(spotify_url' in d) = 0 or position('or (spotify_url is null and' in d) = 0 then
    raise exception 'reconcile patch did not apply';
  end if;
  execute d;
end $$;
