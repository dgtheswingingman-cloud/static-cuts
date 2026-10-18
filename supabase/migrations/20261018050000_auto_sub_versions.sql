-- Auto sub-versions, and "*" songs tagged as leaked.
--
-- 1. Songs whose title ends in "*" (the archive's mark for unreleased) and
--    are still "unconfirmed" become "leaked". One undoable batch.
--
-- 2. Versions are linked under their main song. A title is read as
--    "<base> (<version>)" or "<base> - <version>" (several bracket groups are
--    fine: "Song (Remix) (Demo)"). The version label decides how sure we are:
--      sure   Live, Demo, Remix, Mix, Instrumental, Acapella, Acoustic,
--             Slowed, Sped, Remaster, Version, Edit, Session, Rehearsal,
--             Alt, OG, Original, Early, CDQ, Extended, Radio, Stripped,
--             Rework, Bootleg, Reprise, Reference, Snippet, Clean, Explicit,
--             Vocal(s), V2, Take 2...
--      skip   Intro, Interlude, Skit, Outro (usually different songs)
--      dupe   "Dupe": offered as a merge instead
--      check  anything else (Freestyle, years, Part 2, names...)
--    Sure versions with a main song on the same artist's page are linked
--    straight away. Sure versions with no main song get one created, except
--    remixes (a remix with no original on the page is usually the remixer's
--    own take on someone else's song). Everything else that has a likely
--    main song goes on the review list at /admin/versions.
--    The official release always stays the main song: only plain titles
--    (no version label) are ever used as the main song.
--
-- 3. New songs added later are linked automatically when they're a sure
--    version of a song already on the same page.

-- Batches can also be started from the SQL editor.
create or replace function sc_begin_batch(p_kind text, p_label text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing uuid := nullif(current_setting('static_cuts.batch_id', true), '')::uuid;
  v_id uuid;
  v_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  if not (is_admin() or v_role = 'service_role' or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'not authorized';
  end if;
  if v_existing is not null and exists (select 1 from change_batches where id = v_existing) then
    return v_existing;
  end if;
  insert into change_batches (kind, label) values (p_kind, p_label) returning id into v_id;
  perform set_config('static_cuts.batch_id', v_id::text, true);
  delete from change_batches where created_at < now() - interval '60 days';
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading a title
-- ---------------------------------------------------------------------------

create or replace function sc_version_info(p_title text, out base text, out version text, out cls text)
returns record
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  c text;
  v text;
begin
  -- Drop (feat. ...) / (prod. ...) groups and the trailing "*".
  c := trim(regexp_replace(
         regexp_replace(coalesce(p_title, ''), '\s*[\(\[]\s*(feat\.?|ft\.?|featuring|with|prod\.?|produced by)\s[^\)\]]*[\)\]]', '', 'gi'),
         '\*+\s*$', ''));
  if c ~ '[\)\]]\s*$' then
    base := trim(regexp_replace(c, '(\s*[\(\[][^\(\)\[\]]*[\)\]])+\s*$', ''));
    v := substring(c from '((\s*[\(\[][^\(\)\[\]]*[\)\]])+)\s*$');
    version := trim(regexp_replace(regexp_replace(v, '\s*[\)\]]\s*[\(\[]\s*', ', ', 'g'), '[\(\)\[\]]', '', 'g'));
  elsif c ~ '\S\s+[-–]\s+[^-–]+$' then
    base := (regexp_match(c, '^(.*\S)\s+[-–]\s+[^-–]+$'))[1];
    version := trim((regexp_match(c, '\s[-–]\s+([^-–]+)$'))[1]);
  end if;
  if coalesce(base, '') = '' or coalesce(version, '') = '' then
    base := null;
    version := null;
    return;
  end if;
  v := lower(version);
  cls := case
    when v ~ '^(intro|interlude|skit|outro)$' then 'skip'
    when v ~ '\mdupe\M' then 'dupe'
    when v ~ '\m(live|demo|demos|remix|remixed|mix|mixed|instrumental|acapella|a cappella|acoustic|slowed|sped|reverb|remaster|remastered|version|edit|session|sessions|unplugged|rehearsal|alt|alternate|og|original|early|cdq|extended|radio|stripped|rework|bootleg|reprise|reference|ref|snippet|clean|explicit|vocal|vocals|v\d+|take \d+)\M'
      then 'sure'
    else 'check'
  end;
end;
$$;

-- Fast lookups by artist and normalised title.
create index if not exists tracks_artist_title_key_idx on tracks (artist_id, sc_title_key(title));

-- The main song a base title belongs to on one artist's page: a plain title
-- (no version label), best copy first (has a link, highest status).
create or replace function sc_main_song(p_artist_id text, p_base text)
returns text
language sql
stable
set search_path to 'public'
as $$
  select t.id from tracks t
  where t.artist_id = p_artist_id and t.parent_track_id is null
    and sc_title_key(t.title) = sc_title_key(p_base)
    and (sc_version_info(t.title)).base is null
  order by (t.spotify_url is null), release_status_rank(t.release_status) desc, t.id
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Suggestions (the review list)
-- ---------------------------------------------------------------------------

create table if not exists version_suggestions (
  id uuid primary key default gen_random_uuid(),
  track_id text not null references tracks(id) on delete cascade,
  parent_track_id text references tracks(id) on delete cascade,
  create_parent_title text,
  version text,
  cls text not null check (cls in ('sure', 'check', 'cross', 'dupe')),
  action text not null check (action in ('link', 'create_parent', 'merge')),
  state text not null default 'open' check (state in ('open', 'applied', 'dismissed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index if not exists version_suggestions_open_track_key on version_suggestions (track_id) where state = 'open';
create index if not exists version_suggestions_state_idx on version_suggestions (state, cls);
alter table version_suggestions enable row level security;
drop policy if exists version_suggestions_admin_read on version_suggestions;
create policy version_suggestions_admin_read on version_suggestions for select using (is_admin());
revoke all on version_suggestions from anon;
revoke insert, update, delete on version_suggestions from authenticated;

-- Link one song under a main song (moving any versions it had along with it).
create or replace function sc_link_version(p_track_id text, p_parent_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t tracks%rowtype;
  p tracks%rowtype;
begin
  select * into t from tracks where id = p_track_id;
  select * into p from tracks where id = p_parent_id;
  if t.id is null or p.id is null or t.id = p.id then return; end if;
  if p.parent_track_id is not null then
    select * into p from tracks where id = p.parent_track_id;
  end if;
  if t.id = p.id then return; end if;
  -- A version from another artist's page stays visible there.
  if t.artist_id is distinct from p.artist_id and t.artist_id is not null then
    insert into track_appearances (track_id, artist_id) values (t.id, t.artist_id) on conflict do nothing;
  end if;
  update tracks set parent_track_id = p.id, artist_id = p.artist_id where parent_track_id = t.id;
  update tracks set parent_track_id = p.id, artist_id = p.artist_id where id = t.id;
end;
$$;

-- Apply suggestions. Linking, creating a main song for orphan versions, or
-- merging "Dupe" copies. Groups versions that share a new main song.
create or replace function sc_apply_version_suggestions(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s record;
  v_parent text;
  v_done int := 0;
  t tracks%rowtype;
begin
  for s in
    select vs.*, tr.artist_id as track_artist
    from version_suggestions vs join tracks tr on tr.id = vs.track_id
    where vs.id = any (p_ids) and vs.state = 'open'
    order by vs.action, vs.create_parent_title, vs.id
  loop
    if s.action = 'link' then
      perform sc_link_version(s.track_id, s.parent_track_id);
    elsif s.action = 'merge' then
      perform admin_merge_duplicates(s.parent_track_id, array[s.track_id]);
    else -- create_parent
      v_parent := coalesce(
        sc_main_song(s.track_artist, s.create_parent_title),
        (select id from tracks
         where artist_id = s.track_artist and parent_track_id is null
           and notes = 'Added automatically to group its versions.'
           and sc_title_key(title) = sc_title_key(s.create_parent_title)
         limit 1));
      if v_parent is null then
        select * into t from tracks where id = s.track_id;
        v_parent := s.track_artist || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
        insert into tracks (id, artist_id, title, release_status, has_audio, notes)
        values (
          v_parent, s.track_artist, s.create_parent_title,
          -- If any version is officially out, so is the song.
          case when exists (
            select 1 from version_suggestions o join tracks ot on ot.id = o.track_id
            where o.state = 'open' and o.action = 'create_parent' and ot.artist_id = s.track_artist
              and sc_title_key(o.create_parent_title) = sc_title_key(s.create_parent_title)
              and ot.release_status = 'released')
          then 'released' else 'unconfirmed' end,
          false,
          'Added automatically to group its versions.');
      end if;
      perform sc_link_version(s.track_id, v_parent);
    end if;
    update version_suggestions set state = 'applied', decided_at = now() where id = s.id;
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;

-- Find suggestions for some artists (or all, when p_artist_ids is null).
-- Returns how many new suggestions were added.
create or replace function sc_scan_versions(p_artist_ids text[] default null)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n int;
begin
  with t as (
    select tr.id, tr.artist_id, tr.title, (sc_version_info(tr.title)).*
    from tracks tr
    where tr.parent_track_id is null
      and (p_artist_ids is null or tr.artist_id = any (p_artist_ids))
  ),
  versions as (
    select * from t where base is not null and cls <> 'skip'
  ),
  mains as (
    select distinct on (tr.artist_id, sc_title_key(tr.title))
      tr.artist_id, sc_title_key(tr.title) k, tr.id
    from tracks tr
    where tr.parent_track_id is null
      and sc_title_key(tr.title) in (select sc_title_key(base) from versions)
      and (sc_version_info(tr.title)).base is null
    order by tr.artist_id, sc_title_key(tr.title), (tr.spotify_url is null), release_status_rank(tr.release_status) desc, tr.id
  ),
  matched as (
    select v.*, m.id as parent_id,
      -- Remixes with no original on the page: is there exactly one other
      -- artist with that song?
      case when m.id is null and lower(v.version) ~ '\mremix' then (
        select case when count(*) = 1 then min(m2.id) end
        from mains m2 where m2.k = sc_title_key(v.base) and m2.artist_id <> v.artist_id)
      end as cross_parent
    from versions v
    left join mains m on m.artist_id = v.artist_id and m.k = sc_title_key(v.base)
  ),
  cand as (
    select id as track_id,
      coalesce(parent_id, cross_parent) as parent_track_id,
      case when parent_id is null and cross_parent is null then base end as create_parent_title,
      version,
      case when cls = 'dupe' then 'dupe'
           when parent_id is null and cross_parent is not null then 'cross'
           else cls end as cls,
      case when cls = 'dupe' then 'merge'
           when parent_id is null and cross_parent is null then 'create_parent'
           else 'link' end as action
    from matched
    where (parent_id is not null or cross_parent is not null)
       or (cls = 'sure' and lower(version) !~ '\mremix')
  )
  insert into version_suggestions (track_id, parent_track_id, create_parent_title, version, cls, action)
  select r.* from cand r
  where (r.action <> 'merge' or r.parent_track_id is not null)
    and not exists (select 1 from version_suggestions vs
                    where vs.track_id = r.track_id and vs.state in ('open', 'dismissed'))
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin calls for /admin/versions
-- ---------------------------------------------------------------------------

create or replace function admin_version_suggestions(p_cls text default null, p_limit int default 500)
returns table (
  id uuid, cls text, action text, version text,
  track_id text, track_title text, track_status text, track_artist_id text, track_artist text,
  parent_track_id text, parent_title text, parent_artist text, create_parent_title text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select vs.id, vs.cls, vs.action, vs.version,
         t.id, t.title, t.release_status, t.artist_id, ta.name,
         p.id, p.title, pa.name, vs.create_parent_title
  from version_suggestions vs
  join tracks t on t.id = vs.track_id
  left join artists ta on ta.id = t.artist_id
  left join tracks p on p.id = vs.parent_track_id
  left join artists pa on pa.id = p.artist_id
  where is_admin() and vs.state = 'open' and (p_cls is null or vs.cls = p_cls)
  order by ta.name, coalesce(p.title, vs.create_parent_title), t.title
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

create or replace function admin_apply_version_suggestions(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  perform sc_begin_batch('sub_versions', 'Sub-versions: ' || coalesce(array_length(p_ids, 1), 0) || ' approved');
  return sc_apply_version_suggestions(p_ids[1:300]);
end;
$$;

create or replace function admin_dismiss_version_suggestions(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n int;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  update version_suggestions set state = 'dismissed', decided_at = now()
  where id = any (p_ids) and state = 'open';
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function admin_scan_versions(p_artist_ids text[] default null)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  return sc_scan_versions(p_artist_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- New songs: link sure versions as they're added
-- ---------------------------------------------------------------------------

create or replace function tracks_auto_parent()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  vi record;
  v_parent text;
begin
  if new.parent_track_id is not null or new.artist_id is null then
    return new;
  end if;
  select * into vi from sc_version_info(new.title);
  if vi.base is null or vi.cls <> 'sure' then
    return new;
  end if;
  v_parent := sc_main_song(new.artist_id, vi.base);
  if v_parent is not null and v_parent <> new.id then
    new.parent_track_id := v_parent;
  end if;
  return new;
end;
$$;

drop trigger if exists tracks_auto_parent on tracks;
create trigger tracks_auto_parent before insert on tracks
for each row execute function tracks_auto_parent();

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke execute on function sc_link_version(text, text), sc_apply_version_suggestions(uuid[]),
  sc_scan_versions(text[]), tracks_auto_parent() from public, anon, authenticated;
revoke execute on function admin_version_suggestions(text, int), admin_apply_version_suggestions(uuid[]),
  admin_dismiss_version_suggestions(uuid[]), admin_scan_versions(text[]) from public, anon;
grant execute on function admin_version_suggestions(text, int), admin_apply_version_suggestions(uuid[]),
  admin_dismiss_version_suggestions(uuid[]), admin_scan_versions(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Run it: tag "*" songs, then scan and link the sure versions.
-- Each is its own batch in the undo history.
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('tidy', 'Songs ending in * tagged as leaked');
  -- Known songs, not news: keep them out of the status history.
  perform set_config('static_cuts.skip_status_log', 'on', true);
  update tracks set release_status = 'leaked'
  where title ~ '\*\s*$' and release_status = 'unconfirmed' and spotify_url is null;
  perform set_config('static_cuts.skip_status_log', '', true);
end $$;

do $$
declare
  v_ids uuid[];
begin
  perform sc_scan_versions(null);
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('sub_versions', 'Auto sub-versions: sure matches');
  select array_agg(id) into v_ids from version_suggestions where state = 'open' and cls = 'sure';
  perform sc_apply_version_suggestions(coalesce(v_ids, '{}'));
end $$;

select cls, action, state, count(*) from version_suggestions group by 1, 2, 3 order by 1, 2, 3;
