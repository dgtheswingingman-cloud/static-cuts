-- Two more open sources.
--
-- Odesli (song.link): from a song's Spotify link, the same song on Apple
-- Music, YouTube, YouTube Music, Tidal, Amazon Music, SoundCloud, Deezer...
-- Saved in track_platform_links and shown under "Listen" on song pages.
--
-- Wikipedia: artist bios. The artist's Wikipedia page is found through their
-- MusicBrainz links (Wikidata -> English Wikipedia), never by name, and its
-- summary replaces a Last.fm bio (never one written on Static Cuts).

create table if not exists track_platform_links (
  track_id text not null references tracks(id) on delete cascade,
  platform text not null,
  url text not null,
  updated_at timestamptz not null default now(),
  primary key (track_id, platform)
);
alter table track_platform_links enable row level security;
drop policy if exists track_platform_links_read on track_platform_links;
create policy track_platform_links_read on track_platform_links for select using (true);

alter table tracks add column if not exists odesli_checked_at timestamptz, add column if not exists odesli_claim_at timestamptz;
create index if not exists tracks_odesli_pending_idx on tracks (id) where spotify_url is not null and odesli_checked_at is null;

alter table artists add column if not exists wiki_checked_at timestamptz, add column if not exists wiki_claim_at timestamptz;

insert into sc_private_settings (key, value) values
  ('odesli_per_minute', '9'), ('odesli_per_day', '12000'),
  ('wikimedia_per_minute', '60'), ('wikimedia_per_day', '5000')
on conflict (key) do nothing;

-- Next song to look up: main songs first, the most played first.
create or replace function sc_odesli_next(p_secret text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare r record;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  select t.id, t.spotify_url into r from tracks t left join track_popularity p on p.track_id = t.id
  where t.spotify_url is not null and t.odesli_checked_at is null
    and (t.odesli_claim_at is null or t.odesli_claim_at < now() - interval '10 minutes')
  order by (t.parent_track_id is null) desc, p.listens desc nulls last, t.id
  limit 1 for update of t skip locked;
  if not found then return null; end if;
  update tracks set odesli_claim_at = now() where id = r.id;
  return jsonb_build_object('track_id', r.id, 'spotify_url', r.spotify_url);
end $function$;

-- Save what Odesli found (p_links = {"youtube": "https://...", ...}; null = failed, try later).
create or replace function sc_odesli_save(p_secret text, p_track text, p_links jsonb)
returns int language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  if p_links is null then
    update tracks set odesli_claim_at = now() + interval '1 day' where id = p_track;
    return 0;
  end if;
  insert into track_platform_links (track_id, platform, url, updated_at)
  select p_track, k, left(v, 500), now() from jsonb_each_text(p_links) x(k, v)
  where k in ('appleMusic', 'youtube', 'youtubeMusic', 'tidal', 'amazonMusic', 'soundcloud', 'deezer', 'bandcamp', 'audiomack', 'pandora')
    and v ~* '^https://'
  on conflict (track_id, platform) do update set url = excluded.url, updated_at = now();
  get diagnostics n = row_count;
  update tracks set
    apple_url = coalesce(apple_url, nullif(p_links ->> 'appleMusic', '')),
    deezer_url = coalesce(deezer_url, nullif(p_links ->> 'deezer', '')),
    odesli_checked_at = now(), odesli_claim_at = null
  where id = p_track;
  return n;
end $function$;

-- Next artist for Wikipedia (every 60 days).
create or replace function sc_wiki_next(p_secret text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare r record;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  select a.id, a.musicbrainz_id into r from artists a left join sc_artist_weights() w on w.artist_id = a.id
  where a.musicbrainz_id is not null and coalesce(a.bio_source, '') <> 'Static Cuts'
    and (a.wiki_checked_at is null or a.wiki_checked_at < now() - interval '60 days')
    and (a.wiki_claim_at is null or a.wiki_claim_at < now() - interval '5 minutes')
  order by a.wiki_checked_at nulls first, coalesce(w.weight, 0) desc, a.id
  limit 1 for update of a skip locked;
  if not found then return null; end if;
  update artists set wiki_claim_at = now() where id = r.id;
  return jsonb_build_object('artist_id', r.id, 'mbid', r.musicbrainz_id);
end $function$;

-- Save an artist's Wikipedia summary (p_summary null = no page; p_url null too = failed, retry tomorrow).
create or replace function sc_wiki_save(p_secret text, p_artist text, p_summary text, p_url text, p_failed boolean default false)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  if p_failed then
    update artists set wiki_checked_at = now() - interval '59 days', wiki_claim_at = null where id = p_artist;
    return;
  end if;
  update artists set
    bio = case when length(coalesce(p_summary, '')) >= 60 and coalesce(bio_source, '') <> 'Static Cuts' then left(btrim(p_summary), 4000) else bio end,
    bio_source = case when length(coalesce(p_summary, '')) >= 60 and coalesce(bio_source, '') <> 'Static Cuts' then 'Wikipedia' else bio_source end,
    bio_source_url = case when length(coalesce(p_summary, '')) >= 60 and coalesce(bio_source, '') <> 'Static Cuts' then p_url else bio_source_url end,
    links = case when p_url is not null and not coalesce(links, '[]'::jsonb) @> '[{"type":"Wikipedia"}]'
                 then coalesce(links, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('type', 'Wikipedia', 'url', p_url)) else links end,
    wiki_checked_at = now(), wiki_claim_at = null
  where id = p_artist;
end $function$;

revoke execute on function sc_odesli_next(text), sc_odesli_save(text, text, jsonb), sc_wiki_next(text),
  sc_wiki_save(text, text, text, text, boolean) from public, anon, authenticated;

select cron.schedule('odesli-sync', '* * * * *', $$ select net.http_post(url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.sc_private_settings where key='cron_secret')), body := jsonb_build_object('fn','odesli-sync','body','{}'::jsonb), timeout_milliseconds := 15000); $$);
select cron.schedule('wikipedia-sync', '*/5 * * * *', $$ select net.http_post(url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.sc_private_settings where key='cron_secret')), body := jsonb_build_object('fn','wikipedia-sync','body','{}'::jsonb), timeout_milliseconds := 15000); $$);

-- Odesli answered 401: it no longer accepts calls without an allowlisted
-- key. Timer off until Static Cuts is allowlisted (then re-add 'odesli-sync').
select cron.unschedule('odesli-sync');
