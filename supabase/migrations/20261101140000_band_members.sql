-- Band members from MusicBrainz (open data, CC0): who's in which band, what
-- they play and when. A background job (musicbrainz-sync, every 2 minutes,
-- one request a second) finds each artist on MusicBrainz, by their Spotify
-- link where there is one, otherwise by name, and saves their band links.
--
-- Band pages show "Members" (with instrument and years; former members
-- marked), members' pages show "Also in". People with a page here are
-- linked; others are listed by name. Moderators can hide a wrong link or
-- say "not them" to a wrong MusicBrainz match. Members added by hand
-- (artist_members) still show as before.

alter table artists add column if not exists musicbrainz_id text;
alter table artists add column if not exists mb_type text;
alter table artists add column if not exists mb_checked_at timestamptz;
alter table artists add column if not exists mb_claim_at timestamptz;
create index if not exists artists_musicbrainz_idx on artists (musicbrainz_id) where musicbrainz_id is not null;

-- kind 'member': other is a member of this artist (this artist is a band).
-- kind 'group':  this artist is a member of other.
create table if not exists artist_mb_links (
  artist_id text not null references artists (id) on delete cascade,
  other_mbid text not null,
  other_name text not null,
  kind text not null check (kind in ('member', 'group')),
  roles text[] not null default '{}',
  begin_year integer,
  end_year integer,
  ended boolean not null default false,
  hidden boolean not null default false,
  seen_at timestamptz not null default now(),
  primary key (artist_id, other_mbid, kind)
);
create index if not exists artist_mb_links_other_idx on artist_mb_links (other_mbid);
alter table artist_mb_links enable row level security;
revoke all on artist_mb_links from anon, authenticated;

insert into sc_private_settings (key, value) values ('musicbrainz_per_minute', '50'), ('musicbrainz_per_day', '50000')
on conflict (key) do nothing;

-- Next artist to look up (claims it for 5 minutes).
create or replace function sc_mb_next(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v record;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  select a.id, a.name, a.spotify_artist_id, a.musicbrainz_id into v
  from artists a left join sc_artist_weights() w on w.artist_id = a.id
  where coalesce(a.musicbrainz_id, '') <> 'none'
    and (a.mb_checked_at is null or a.mb_checked_at < now() - interval '60 days')
    and (a.mb_claim_at is null or a.mb_claim_at < now() - interval '5 minutes')
  order by a.mb_checked_at nulls first, coalesce(w.weight, 0) desc, a.id
  limit 1
  for update of a skip locked;
  if v.id is null then return null; end if;
  update artists set mb_claim_at = now() where id = v.id;
  return jsonb_build_object('artist_id', v.id, 'name', v.name,
    'spotify_id', case when v.spotify_artist_id ~ '^[A-Za-z0-9]{22}$' then v.spotify_artist_id end,
    'mbid', v.musicbrainz_id);
end;
$$;

-- Which page here a MusicBrainz artist is: same MusicBrainz id, or the same
-- name on a page not yet matched to anyone else.
create or replace function sc_mb_site_artist(p_mbid text, p_name text, p_not text default null)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select id from artists where musicbrainz_id = p_mbid and id is distinct from p_not order by id limit 1),
    (select id from artists where musicbrainz_id is null and lower(name) = lower(p_name) and id is distinct from p_not order by id limit 1));
$$;

-- Save one artist's result. p_matched_by: 'saved' | 'spotify' | 'name'.
-- A match by name alone is only kept when it links to someone already on
-- the site (a same-named stranger rarely does).
create or replace function sc_mb_save(p_secret text, p_artist text, p_mbid text, p_type text, p_matched_by text, p_links jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n int;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  if p_mbid is not null and p_matched_by = 'name' and not exists (
       select 1 from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) l
       where sc_mb_site_artist(l ->> 'mbid', l ->> 'name', p_artist) is not null) then
    p_mbid := null;
  end if;
  if p_mbid is null then
    -- Not found: try again in a month.
    update artists set mb_checked_at = now() - interval '30 days', mb_claim_at = null where id = p_artist;
    return 0;
  end if;
  update artists set musicbrainz_id = p_mbid, mb_type = p_type, mb_checked_at = now(), mb_claim_at = null where id = p_artist;
  insert into artist_mb_links (artist_id, other_mbid, other_name, kind, roles, begin_year, end_year, ended, seen_at)
  select p_artist, l ->> 'mbid', l ->> 'name', l ->> 'kind',
         coalesce(array(select jsonb_array_elements_text(l -> 'roles')), '{}'),
         nullif(l ->> 'begin', '')::int, nullif(l ->> 'end', '')::int, coalesce((l ->> 'ended')::boolean, false), now()
  from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) l
  where l ->> 'kind' in ('member', 'group') and coalesce(l ->> 'mbid', '') <> '' and coalesce(l ->> 'name', '') <> ''
  on conflict (artist_id, other_mbid, kind) do update
    set other_name = excluded.other_name, roles = excluded.roles, begin_year = excluded.begin_year,
        end_year = excluded.end_year, ended = excluded.ended, seen_at = excluded.seen_at;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function sc_mb_next(text), sc_mb_save(text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function sc_mb_site_artist(text, text, text) from public, anon, authenticated;

-- An artist's members and bands for the artist page: added by hand, plus
-- MusicBrainz (this page's links and other pages' links pointing here).
create or replace function rpc_artist_groups(p_artist_id text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with me as (select id, musicbrainz_id mbid from artists where id = p_artist_id),
  mb as (
    select l.kind, l.other_mbid mbid, l.other_name name, l.roles, l.begin_year, l.end_year, l.ended,
           sc_mb_site_artist(l.other_mbid, l.other_name, p_artist_id) site_id
    from artist_mb_links l join artists a on a.id = l.artist_id
    where l.artist_id = p_artist_id and not l.hidden and l.seen_at >= a.mb_checked_at
    union all
    select case l.kind when 'member' then 'group' else 'member' end, a.musicbrainz_id, a.name, l.roles,
           l.begin_year, l.end_year, l.ended, a.id
    from me join artist_mb_links l on l.other_mbid = me.mbid
    join artists a on a.id = l.artist_id
    where me.mbid is not null and me.mbid <> 'none' and l.artist_id <> p_artist_id
      and not l.hidden and l.seen_at >= a.mb_checked_at
  ),
  allrows as (
    select kind, mbid, name, roles, begin_year, end_year, ended, site_id, 1 as pri from mb
    union all
    select 'member', null, a.name, '{}', null, null, false, a.id, 0
    from artist_members m join artists a on a.id = m.member_id where m.group_id = p_artist_id
    union all
    select 'group', null, a.name, '{}', null, null, false, a.id, 0
    from artist_members m join artists a on a.id = m.group_id where m.member_id = p_artist_id
  ),
  one as (
    -- Same person/band twice (both directions, or by hand too): keep the
    -- one with the most detail.
    select distinct on (kind, coalesce(site_id, mbid)) *
    from allrows
    order by kind, coalesce(site_id, mbid), cardinality(roles) desc, pri desc
  )
  select jsonb_build_object(
    'mbid', (select case when mbid <> 'none' then mbid end from me),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', o.site_id, 'name', coalesce(a.name, o.name), 'mbid', o.mbid,
                  'roles', o.roles, 'from', o.begin_year, 'to', o.end_year, 'former', o.ended)
                  order by o.ended, o.begin_year nulls last, coalesce(a.name, o.name)), '[]'::jsonb)
                from one o left join artists a on a.id = o.site_id where o.kind = 'member'),
    'groups', (select coalesce(jsonb_agg(jsonb_build_object('id', o.site_id, 'name', coalesce(a.name, o.name), 'mbid', o.mbid,
                 'roles', o.roles, 'from', o.begin_year, 'to', o.end_year, 'former', o.ended,
                 'songs', case when o.site_id is not null then (select count(*) from tracks t where t.artist_id = o.site_id and t.parent_track_id is null) else 0 end,
                 'recent', case when o.site_id is not null then (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'status', x.release_status)), '[]'::jsonb)
                            from (select t.id, t.title, t.release_status from tracks t
                                  where t.artist_id = o.site_id and t.parent_track_id is null
                                  order by t.release_date desc nulls last, t.created_at desc limit 12) x) else '[]'::jsonb end)
                 order by o.ended, o.site_id is null, o.begin_year nulls last, coalesce(a.name, o.name)), '[]'::jsonb)
               from one o left join artists a on a.id = o.site_id where o.kind = 'group')
  );
$$;
grant execute on function rpc_artist_groups(text) to anon, authenticated;

-- Moderators: hide a wrong MusicBrainz link (both directions).
create or replace function admin_hide_mb_link(p_artist text, p_other_mbid text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me text := (select musicbrainz_id from artists where id = p_artist);
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  update artist_mb_links set hidden = true
  where (artist_id = p_artist and other_mbid = p_other_mbid)
     or (v_me is not null and other_mbid = v_me and artist_id in (select id from artists where musicbrainz_id = p_other_mbid));
end;
$$;
revoke execute on function admin_hide_mb_link(text, text) from public, anon;
grant execute on function admin_hide_mb_link(text, text) to authenticated;

-- Moderators: "not them" (wrong MusicBrainz match), or set the right one
-- (a MusicBrainz artist link or id); it's looked up again shortly.
create or replace function admin_set_musicbrainz(p_artist text, p_value text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id text := substring(coalesce(p_value, '') from '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})');
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if v_id is null then
    update artists set musicbrainz_id = 'none', mb_type = null, mb_checked_at = now() where id = p_artist;
  else
    update artists set musicbrainz_id = v_id, mb_checked_at = null, mb_claim_at = null where id = p_artist;
  end if;
end;
$$;
revoke execute on function admin_set_musicbrainz(text, text) from public, anon;
grant execute on function admin_set_musicbrainz(text, text) to authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'musicbrainz-sync';
select cron.schedule('musicbrainz-sync', '1-59/2 * * * *', $c$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/musicbrainz-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$c$);
