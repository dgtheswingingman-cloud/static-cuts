-- Discogs: physical releases (vinyl, CD, tape). The discogs-sync job finds each
-- artist's Discogs id through MusicBrainz, reads their main releases, then for
-- each album ("master") reads its versions to see which formats it was pressed
-- on. Album pages show "Pressed on vinyl · CD · cassette" with a Discogs link.
alter table artists add column if not exists discogs_id bigint,
  add column if not exists discogs_checked_at timestamptz, add column if not exists discogs_claim_at timestamptz;

create table if not exists discogs_releases (
  artist_id text not null references artists(id) on delete cascade,
  kind text not null check (kind in ('master', 'release')),
  discogs_id bigint not null,
  title text not null,
  year int,
  format text,
  label text,
  thumb text,
  formats text[],
  versions int,
  formats_at timestamptz,
  formats_claim_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (artist_id, kind, discogs_id)
);
create index if not exists discogs_releases_pending_idx on discogs_releases (updated_at) where kind = 'master' and formats_at is null;
alter table discogs_releases enable row level security;
drop policy if exists discogs_releases_read on discogs_releases;
create policy discogs_releases_read on discogs_releases for select using (true);

insert into sc_private_settings (key, value) values ('discogs_per_minute', '20'), ('discogs_per_day', '8000')
on conflict (key) do nothing;

-- Next piece of work: a master whose formats aren't known yet, else an artist
-- to (re)read (every 30 days).
create or replace function sc_discogs_next(p_secret text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare r record;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  select d.artist_id, d.discogs_id into r from discogs_releases d
  where d.kind = 'master' and d.formats_at is null and (d.formats_claim_at is null or d.formats_claim_at < now() - interval '5 minutes')
  order by d.updated_at, d.discogs_id limit 1 for update skip locked;
  if found then
    update discogs_releases set formats_claim_at = now() where artist_id = r.artist_id and kind = 'master' and discogs_id = r.discogs_id;
    return jsonb_build_object('task', 'master', 'artist_id', r.artist_id, 'master_id', r.discogs_id);
  end if;
  select a.id, a.musicbrainz_id, a.discogs_id into r from artists a left join sc_artist_weights() w on w.artist_id = a.id
  where a.musicbrainz_id is not null
    and (a.discogs_checked_at is null or a.discogs_checked_at < now() - interval '30 days')
    and (a.discogs_claim_at is null or a.discogs_claim_at < now() - interval '5 minutes')
  order by a.discogs_checked_at nulls first, coalesce(w.weight, 0) desc, a.id
  limit 1 for update of a skip locked;
  if not found then return null; end if;
  update artists set discogs_claim_at = now() where id = r.id;
  return jsonb_build_object('task', 'artist', 'artist_id', r.id, 'mbid', r.musicbrainz_id, 'discogs_id', r.discogs_id);
end $function$;

-- Save an artist's Discogs id and main releases. p_discogs null = not on
-- Discogs (checked again in 30 days); p_items null = Discogs failed (retry tomorrow).
create or replace function sc_discogs_save_artist(p_secret text, p_artist text, p_discogs bigint, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  if p_items is null and p_discogs is not null then
    update artists set discogs_checked_at = now() - interval '29 days', discogs_claim_at = null where id = p_artist;
    return jsonb_build_object('saved', 0, 'retry', true);
  end if;
  update artists set discogs_id = p_discogs, discogs_checked_at = now(), discogs_claim_at = null where id = p_artist;
  if p_discogs is null then return jsonb_build_object('saved', 0); end if;
  -- The Discogs link alongside the artist's other links.
  update artists set links = coalesce(links, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('type', 'Discogs', 'url', 'https://www.discogs.com/artist/' || p_discogs))
  where id = p_artist and not coalesce(links, '[]'::jsonb) @> '[{"type":"Discogs"}]';
  insert into discogs_releases (artist_id, kind, discogs_id, title, year, format, label, thumb, updated_at)
  select p_artist, x ->> 'type', (x ->> 'id')::bigint, left(x ->> 'title', 300), nullif((x ->> 'year')::int, 0),
         left(nullif(x ->> 'format', ''), 200), left(nullif(x ->> 'label', ''), 200), nullif(x ->> 'thumb', ''), now()
  from jsonb_array_elements(coalesce(p_items, '[]')) x
  where x ->> 'type' in ('master', 'release') and (x ->> 'id') ~ '^\d+$' and coalesce(x ->> 'title', '') <> ''
  on conflict (artist_id, kind, discogs_id) do update set title = excluded.title, year = excluded.year, format = excluded.format,
    label = excluded.label, thumb = excluded.thumb, updated_at = now();
  get diagnostics n = row_count;
  return jsonb_build_object('saved', n);
end $function$;

-- Save the formats an album was released on (p_formats null = failed, retry later).
create or replace function sc_discogs_save_master(p_secret text, p_artist text, p_master bigint, p_formats text[], p_versions int)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  update discogs_releases set formats = coalesce(p_formats, formats), versions = coalesce(p_versions, versions),
    formats_at = case when p_formats is null then null else now() end,
    formats_claim_at = case when p_formats is null then now() + interval '1 day' else null end
  where artist_id = p_artist and kind = 'master' and discogs_id = p_master;
end $function$;
revoke execute on function sc_discogs_next(text), sc_discogs_save_artist(text, text, bigint, jsonb),
  sc_discogs_save_master(text, text, bigint, text[], int) from public, anon, authenticated;

-- For an album page: the Discogs album with the same title by the same artist.
create or replace function rpc_album_discogs(p_album text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('id', d.discogs_id, 'formats', coalesce(d.formats, '{}'), 'versions', d.versions,
                            'url', 'https://www.discogs.com/master/' || d.discogs_id)
  from deezer_albums al join discogs_releases d on d.artist_id = al.artist_id and d.kind = 'master'
   and sc_title_key(d.title) = sc_title_key(al.title)
  where al.album_id = p_album
  order by d.versions desc nulls last limit 1
$$;
grant execute on function rpc_album_discogs(text) to anon, authenticated;

select cron.schedule('discogs-sync', '*/5 * * * *', $$ select net.http_post(url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.sc_private_settings where key='cron_secret')), body := jsonb_build_object('fn','discogs-sync','body','{}'::jsonb), timeout_milliseconds := 15000); $$);

-- A MusicBrainz refresh replaces an artist's links: keep the Discogs one.
do $do$
declare d text := pg_get_functiondef('sc_mb_info'::regproc); n text;
begin
  n := replace(d, $a$then p_info -> 'links' else links end,$a$,
    $a$then (p_info -> 'links') || case when discogs_id is not null and not (p_info -> 'links') @> '[{"type":"Discogs"}]'
                      then jsonb_build_array(jsonb_build_object('type', 'Discogs', 'url', 'https://www.discogs.com/artist/' || discogs_id)) else '[]'::jsonb end
         else links end,$a$);
  if n = d then raise exception 'patch did not apply'; end if;
  execute n;
end $do$;
