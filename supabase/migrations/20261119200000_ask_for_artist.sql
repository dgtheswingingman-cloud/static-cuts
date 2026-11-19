-- "Not here? Ask for it": signed-in visitors can ask for an artist the site
-- doesn't have yet. The ask goes to the front of the guest-artist queue
-- (host_weight 2000; searched-for names are 1000), so the guest-artists job
-- looks them up on Deezer within about 10 minutes, with the same checks as
-- everyone else (exact name, one of their songs credited to them, 300+ fans).
-- Asked-for artists can be added beyond the daily new-artist allowance, up to
-- 5 a day (owner's choice, 19 Nov). When the page is made, everyone who asked
-- follows them and gets a notification.

alter table artist_additions drop constraint if exists artist_additions_source_check;
alter table artist_additions add constraint artist_additions_source_check check (source in ('guest', 'related', 'asked'));

create table if not exists artist_asks (
  name_key text not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asked_at timestamptz not null default now(),
  primary key (name_key, user_id)
);
create index if not exists artist_asks_user_idx on artist_asks (user_id, asked_at);
alter table artist_asks enable row level security;
revoke all on table artist_asks from anon, authenticated;

-- New pages left today for asked-for artists (on top of new_artists_per_day).
create or replace function sc_ask_pages_left()
returns int
language sql
stable security definer
set search_path to 'public'
as $$
  select greatest(0, 5 - (select count(*) from artist_additions where source = 'asked' and created_at > now() - interval '1 day'))::int;
$$;
revoke execute on function sc_ask_pages_left() from public, anon, authenticated;

create or replace function rpc_ask_for_artist(p_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_key text := lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
  v_artist text;
  g guest_artists%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to ask for an artist.'; end if;
  if length(v_name) < 2 or length(v_name) > 60 then raise exception 'Type the artist''s name.'; end if;
  if (select count(*) from artist_asks where user_id = auth.uid() and asked_at > now() - interval '1 day') >= 10 then
    raise exception 'That''s 10 asks today. Try again tomorrow.';
  end if;

  -- Already here (by name or another name)?
  v_artist := sc_find_artist(v_name);
  if v_artist is not null then
    return jsonb_build_object('state', 'here', 'artist_id', v_artist);
  end if;

  insert into artist_asks (name_key, user_id) values (v_key, auth.uid())
  on conflict (name_key, user_id) do update set asked_at = now();

  select * into g from guest_artists where name_key = v_key;
  if g.name_key is not null and g.state in ('created', 'linked') and g.artist_id is not null then
    return jsonb_build_object('state', 'here', 'artist_id', g.artist_id);
  end if;
  if g.name_key is not null and g.state in ('review', 'skipped') then
    -- Looked at before and couldn't be confirmed: with the moderators.
    return jsonb_build_object('state', 'checked', 'note', g.note);
  end if;
  insert into guest_artists (name_key, name, songs, state, host_weight, note, updated_at)
  values (v_key, v_name, 0, 'pending', 2000, 'Asked for by a visitor.', now())
  on conflict (name_key) do update
    set host_weight = greatest(guest_artists.host_weight, 2000), checked_at = null, updated_at = now(),
        note = 'Asked for by a visitor.'
    where guest_artists.state = 'pending';
  return jsonb_build_object('state', 'queued',
    'asks', (select count(*) from artist_asks where name_key = v_key));
end $$;
revoke execute on function rpc_ask_for_artist(text) from public, anon;
grant execute on function rpc_ask_for_artist(text) to authenticated;

-- The job's next names, now saying which were asked for and whether
-- asked-for artists can still get a page today.
create or replace function sc_guest_next(p_secret text, p_limit integer default 8)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_wait boolean := sc_new_artists_left() <= 0;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return jsonb_build_object(
    'known', (select coalesce(jsonb_object_agg(spotify_artist_id, id), '{}'::jsonb) from artists where spotify_artist_id is not null),
    'new_pages', not v_wait,
    'asked_pages', sc_ask_pages_left() > 0,
    'guests', (
      with top as (
        select g.* from guest_artists g
        where g.state = 'pending' and (g.songs > 0 or g.host_weight >= 1000)
          -- While new pages wait, each guest is looked at once a week (in
          -- case they turn out to be an artist already here).
          and (g.checked_at is null or g.checked_at < now() - interval '7 days')
        order by g.host_weight desc, g.songs desc, g.name
        limit greatest(1, least(coalesce(p_limit, 8), 20))
      )
      select coalesce(jsonb_agg(jsonb_build_object('key', p.name_key, 'name', p.name, 'searched', p.host_weight >= 1000,
               'asked', p.host_weight >= 2000,
               'titles', (select jsonb_agg(x.title) from (
                  select t.title from tracks t
                  where t.notes like 'Feature on %' and lower(sc_guest_name(t.notes)) = p.name_key
                  order by t.id limit 3) x))), '[]'::jsonb)
      from top p));
end;
$function$;

create or replace function sc_guest_found(p_secret text, p_key text, p_action text, p_artist text default null, p_deezer_id text default null, p_deezer_name text default null, p_note text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  g guest_artists%rowtype;
  v_artist text;
  v_name text;
  v_asked boolean;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select * into g from guest_artists where name_key = p_key;
  if g.name_key is null then return null; end if;
  v_name := coalesce(p_deezer_name, g.name);
  v_asked := g.host_weight >= 2000;
  if p_action = 'review' and g.songs < 3 and not v_asked then
    -- One or two songs: not worth a moderator's time. Noted, and looked at
    -- again in a week (they may have more songs by then).
    update guest_artists set note = p_note, checked_at = now(), deezer_artist_id = coalesce(p_deezer_id, deezer_artist_id)
    where name_key = p_key;
    return null;
  end if;
  if p_action = 'review' then
    -- (Asked-for artists that can't be confirmed go to the moderators.)
    update guest_artists set state = 'review', note = p_note, checked_at = now(),
           deezer_artist_id = coalesce(p_deezer_id, deezer_artist_id)
    where name_key = p_key;
    return null;
  end if;
  if p_action = 'wait' then
    update guest_artists set checked_at = now(), deezer_artist_id = coalesce(p_deezer_id, deezer_artist_id),
           note = 'Waiting: existing artists are being filled in first.'
    where name_key = p_key and state = 'pending';
    return null;
  end if;
  if p_action = 'link' then
    v_artist := p_artist;
  else
    v_artist := coalesce((select id from artists where deezer_artist_id = p_deezer_id limit 1), sc_find_artist(g.name));
    if v_artist is null then
      if sc_new_artists_left() <= 0 and not (v_asked and sc_ask_pages_left() > 0) then
        update guest_artists set checked_at = now(), deezer_artist_id = coalesce(p_deezer_id, deezer_artist_id),
               note = 'Waiting: existing artists are being filled in first.'
        where name_key = p_key and state = 'pending';
        return null;
      end if;
      v_artist := trim(both '-' from lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'))
                  || '-' || substr(gen_random_uuid()::text, 1, 8));
      perform set_config('static_cuts.batch_id', '', true);
      perform sc_begin_batch('guests', 'New artist page: ' || v_name);
      insert into artists (id, name, status, deezer_artist_id) values (v_artist, v_name, 'ONGOING', p_deezer_id);
      insert into artist_additions (artist_id, name, source, note)
      values (v_artist, v_name, case when v_asked then 'asked' else 'guest' end,
              case when v_asked then 'Asked for by ' || (select count(*) from artist_asks where name_key = p_key) || ' visitor(s)'
                   else g.songs || ' song' || case when g.songs = 1 then '' else 's' end || ' credited here' end);
    end if;
  end if;
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('guests', 'Songs moved to ' || v_name || '''s page');
  perform sc_guest_move(p_key, v_artist);
  update guest_artists set state = case when p_action = 'link' then 'linked' else 'created' end, artist_id = v_artist,
         deezer_artist_id = coalesce(p_deezer_id, deezer_artist_id), songs = 0, checked_at = now(), note = null
  where name_key = p_key;

  -- Everyone who asked: following them, with a notification.
  insert into follows (user_id, artist_id)
  select a.user_id, v_artist from artist_asks a where a.name_key = p_key
  on conflict do nothing;
  insert into notifications (user_id, kind, title, body, link, dedupe_key)
  select a.user_id, 'alert', v_name || ' is on Static Cuts now',
         'You asked for them, so you''re following them. Their songs are being filled in.',
         '/artist/' || v_artist, 'asked-' || p_key
  from artist_asks a where a.name_key = p_key
  on conflict do nothing;
  delete from artist_asks where name_key = p_key;
  return v_artist;
end;
$function$;
