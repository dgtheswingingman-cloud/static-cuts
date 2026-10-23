-- 1. Artist photos from Deezer: taken when an artist is found on Deezer (no
--    extra call), and fetched for artists already found who have no photo
--    (one call each). Deezer's blank placeholder picture is skipped.
-- 2. Genius pace (Control room → Owner → Genius): normal / fast / max. The
--    genius-credits timer runs every minute; faster paces use more of the
--    Genius allowance. If Genius ever says "too many requests" it pauses
--    and drops down a pace by itself.

alter table artists add column if not exists deezer_photo_at timestamptz;

create or replace function sc_deezer_photo(p_secret text, p_artist text, p_picture text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not sc_deezer_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  update artists set deezer_photo_at = now(),
    image_url = case when image_url is null and p_picture ~ '^https://[a-z0-9.-]+\.dzcdn\.net/' and p_picture !~ '/artist//'
                     then p_picture else image_url end
  where id = p_artist;
end;
$$;
revoke execute on function sc_deezer_photo(text, text, text) from public, anon, authenticated;

create or replace function sc_deezer_next(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v jsonb;
  v_artist text;
  v_album text;
begin
  if not sc_deezer_secret_ok(p_secret) then raise exception 'not authorized'; end if;
  -- Finish an artist before starting another: unread releases first.
  select d.artist_id, d.album_id into v_artist, v_album
  from deezer_albums d join artists a on a.id = d.artist_id
  left join sc_artist_weights() w on w.artist_id = d.artist_id
  where d.fetched_at is null and a.deezer_list_index is null
    and (d.claimed_at is null or d.claimed_at < now() - interval '2 minutes')
  order by coalesce(w.weight, 0) desc, d.artist_id,
           case d.kind when 'album' then 0 when 'ep' then 1 else 2 end, d.release_date nulls last, d.album_id
  limit 1
  for update of d skip locked;
  if v_album is not null then
    update deezer_albums set claimed_at = now() where artist_id = v_artist and album_id = v_album;
    return jsonb_build_object('kind', 'album', 'artist_id', v_artist, 'album_id', v_album);
  end if;

  -- Photos for artists found on Deezer who still have none (one call each).
  select a.id into v_artist
  from artists a
  where a.deezer_artist_id is not null and a.image_url is null and a.deezer_photo_at is null
    and (a.deezer_claim_at is null or a.deezer_claim_at < now() - interval '2 minutes')
  order by a.id
  limit 1
  for update of a skip locked;
  if v_artist is not null then
    update artists set deezer_claim_at = now() where id = v_artist;
    return (select jsonb_build_object('kind', 'photo', 'artist_id', id, 'deezer_id', deezer_artist_id) from artists where id = v_artist);
  end if;

  select case when a.deezer_artist_id is null
              then jsonb_build_object('kind', 'search', 'artist_id', a.id, 'name', a.name)
              else jsonb_build_object('kind', 'list', 'artist_id', a.id, 'deezer_id', a.deezer_artist_id, 'index', coalesce(a.deezer_list_index, 0)) end,
         a.id
  into v, v_artist
  from artists a
  left join sc_artist_weights() w on w.artist_id = a.id
  left join artist_track_counts c on c.artist_id = a.id
  where ((a.deezer_artist_id is null and (a.deezer_lookup_at is null or a.deezer_lookup_at < now() - interval '60 days'))
      or (a.deezer_artist_id is not null and (a.deezer_list_index is not null or a.deezer_listed_at is null
                                              or a.deezer_listed_at < now() - interval '30 days')))
    and (a.deezer_claim_at is null or a.deezer_claim_at < now() - interval '2 minutes')
  order by a.deezer_list_index is not null desc, coalesce(w.weight, 0) desc,
           (a.deezer_artist_id is not null) desc, coalesce(c.n, 0) desc, a.id
  limit 1
  for update of a skip locked;
  if v_artist is not null then
    update artists set deezer_claim_at = now() where id = v_artist;
  end if;
  return v;
end;
$$;
revoke execute on function sc_deezer_next(text) from public, anon, authenticated;

-- Genius pace.
insert into sc_private_settings (key, value) values ('genius_pace', 'normal') on conflict (key) do nothing;

create or replace function sc_genius_pace(p_secret text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when p_secret = (select value from sc_private_settings where key = 'cron_secret')
              then coalesce((select value from sc_private_settings where key = 'genius_pace'), 'normal') end;
$$;
revoke execute on function sc_genius_pace(text) from public, anon, authenticated;

-- The allowance that goes with each pace (shared with the Genius imports).
create or replace function sc_set_genius_pace(p_pace text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into sc_private_settings (key, value) values
    ('genius_pace', p_pace),
    ('genius_per_minute', case p_pace when 'max' then '200' when 'fast' then '90' else '30' end),
    ('genius_per_day', case p_pace when 'max' then '250000' when 'fast' then '100000' else '5000' end),
    ('genius_pace_note', coalesce(p_note, ''))
  on conflict (key) do update set value = excluded.value;
end;
$$;
revoke execute on function sc_set_genius_pace(text, text) from public, anon, authenticated;

-- Genius said slow down: drop a pace (max → fast → normal).
create or replace function sc_genius_slowed(p_secret text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v text := coalesce((select value from sc_private_settings where key = 'genius_pace'), 'normal');
  n text := case v when 'max' then 'fast' else 'normal' end;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  perform sc_set_genius_pace(n, 'Genius asked us to slow down at ' || to_char(now() at time zone 'Europe/London', 'HH24:MI DD Mon') || ' while on ' || v || '; dropped to ' || n || '.');
  return n;
end;
$$;
revoke execute on function sc_genius_slowed(text) from public, anon, authenticated;

create or replace function owner_set_genius_pace(p_pace text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_owner() then raise exception 'Only the owner can change this.'; end if;
  if p_pace not in ('normal', 'fast', 'max') then raise exception 'Unknown pace.'; end if;
  perform sc_set_genius_pace(p_pace, null);
end;
$$;
revoke execute on function owner_set_genius_pace(text) from public, anon;
grant execute on function owner_set_genius_pace(text) to authenticated;

create or replace function owner_genius()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_owner() then jsonb_build_object(
    'pace', coalesce((select value from sc_private_settings where key = 'genius_pace'), 'normal'),
    'note', nullif((select value from sc_private_settings where key = 'genius_pace_note'), ''),
    'paused_until', (select value from sc_private_settings where key = 'genius_pause_until'),
    'unchecked', (select count(*) from tracks where genius_checked_at is null),
    'checked_last_hour', (select count(*) from tracks where genius_checked_at > now() - interval '1 hour'),
    'calls_last_hour', (select coalesce(sum(calls), 0) from api_budget where service = 'genius' and minute > now() - interval '1 hour')
  ) end;
$$;
revoke execute on function owner_genius() from public, anon;
grant execute on function owner_genius() to authenticated;

-- The songs to check next, faster (it took ~7 seconds with the database
-- busy; now under 1): songs never checked, artist by artist using an index,
-- most followed artists first. Songs checked over 60 days ago are re-checked
-- only when there's nothing new.
create index if not exists tracks_genius_todo_idx on tracks (artist_id)
  where genius_checked_at is null and (producers is null or featured_artists is null or cover_url is null);

create or replace function sc_genius_credit_next(p_secret text, p_limit integer default 15)
returns table(track_id text, title text, artist text, genius_artist_id text, genius_song_id bigint)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 15), 400));
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  return query
  with w as materialized (select * from sc_artist_weights()),
  arts as (select a.id, a.name, a.genius_artist_id, coalesce(w.weight, 0) wt from artists a left join w on w.artist_id = a.id)
  select x.id, x.title, x.name, x.genius_artist_id, x.genius_song_id
  from arts a cross join lateral (
    select t.id, t.title, a.name, a.genius_artist_id, t.genius_song_id, a.wt,
           (t.genius_song_id is null) nosong, (t.parent_track_id is not null) sub, (t.release_status in ('released', 'leaked')) rl
    from tracks t
    where t.artist_id = a.id and t.genius_checked_at is null
      and (t.producers is null or t.featured_artists is null or t.cover_url is null)
    order by (t.genius_song_id is null), (t.parent_track_id is not null), (t.release_status in ('released', 'leaked')) desc, t.id
    limit v_limit) x
  order by x.nosong, x.wt desc, x.sub, x.rl desc, x.id
  limit v_limit;
  if not found then
    return query
    select t.id, t.title, a.name, a.genius_artist_id, t.genius_song_id
    from tracks t join artists a on a.id = t.artist_id
    where t.genius_checked_at < now() - interval '60 days'
      and (t.producers is null or t.featured_artists is null or t.cover_url is null)
    order by t.genius_checked_at
    limit v_limit;
  end if;
end;
$$;
revoke execute on function sc_genius_credit_next(text, integer) from public, anon, authenticated;

-- genius-credits every minute (normal pace still works every 10 minutes).
select cron.schedule('genius-credits', '* * * * *', $cron$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/genius-credits',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$cron$);
