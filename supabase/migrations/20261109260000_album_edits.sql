-- Album edits (9 Nov 2026).
--
-- Anyone signed in can suggest a fix on an album page; moderators apply it
-- straight away (trusted contributors' suggestions too, unless review-only
-- is on). Five kinds:
--   details     title, release date, album vs EP
--   not_artist  this album isn't this artist's (hidden from their page)
--   same_as     this album is an edition / duplicate of another: combined
--   not_same    this edition was grouped by mistake: shown on its own
--   tracklist   a tracklist row is linked to the wrong song (or none)
-- Every applied edit is logged in album_edits with what it replaced, and
-- can be undone from /review/albums. Deezer refreshes never rewrite titles,
-- dates or kinds, and the grouping / tracklist fixes live in their own
-- tables, so nothing is overwritten later.

create table if not exists album_links (
  album_id text primary key,
  group_with text,          -- combine into this album's group
  not_edition boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table album_links enable row level security;

create table if not exists album_track_overrides (
  album_id text not null,
  disk int not null default 1,
  position int not null,
  track_id text references tracks(id) on delete set null,  -- null = not on the site
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (album_id, disk, position)
);
alter table album_track_overrides enable row level security;

create table if not exists album_edits (
  id uuid primary key default gen_random_uuid(),
  album_id text not null,
  artist_id text,
  kind text not null,
  payload jsonb not null,
  before jsonb,
  suggestion_id uuid,
  done_by uuid,
  done_at timestamptz not null default now(),
  undone_at timestamptz
);
alter table album_edits enable row level security;

create table if not exists album_suggestions (
  id uuid primary key default gen_random_uuid(),
  album_id text not null,
  artist_id text references artists(id) on delete cascade,
  kind text not null check (kind in ('details', 'not_artist', 'same_as', 'not_same', 'tracklist')),
  payload jsonb not null default '{}'::jsonb,
  note text,
  source_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by uuid,
  created_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  reviewer_note text
);
alter table album_suggestions enable row level security;

-- Tracklists with the fixes applied.
create or replace view album_tracks_eff as
  select at.album_id, at.disk, at.position, at.title, at.artist, at.duration, at.explicit, at.link,
         case when o.album_id is not null then o.track_id else at.track_id end track_id
  from album_tracks at
  left join album_track_overrides o on o.album_id = at.album_id and o.disk = coalesce(at.disk, 1) and o.position = at.position;
revoke all on album_tracks_eff from public, anon, authenticated;

-- Which group an album belongs to (manual links first), and whether it's an edition.
create or replace function sc_album_grp(p_album text, p_title text)
returns text language sql stable set search_path to 'public' as $$
  select case
    when l.not_edition then 'solo:' || p_album
    when l.group_with is not null then coalesce(
      (select coalesce(sc_album_base(d.title), sc_title_key(d.title), lower(d.title)) from deezer_albums d where d.album_id = l.group_with limit 1),
      'solo:' || l.group_with)
    else coalesce(sc_album_base(p_title), sc_title_key(p_title), lower(p_title)) end
  from (select 1) one left join album_links l on l.album_id = p_album
$$;

create or replace function sc_album_is_edition(p_album text, p_title text)
returns boolean language sql stable set search_path to 'public' as $$
  select case
    when l.not_edition then false
    when l.group_with is not null then true
    else sc_album_base(p_title) is distinct from sc_title_key(p_title) end
  from (select 1) one left join album_links l on l.album_id = p_album
$$;

-- What an edition is called next to the original.
create or replace function sc_edition_name(p_album text, p_title text)
returns text language sql stable set search_path to 'public' as $$
  select case when sc_album_base(p_title) is distinct from sc_title_key(p_title) then sc_edition_label(p_title) else p_title end
$$;

create or replace function sc_album_group(p_album text)
returns table(album_id text, title text, kind text, release_date date, songs int, is_edition boolean, is_main boolean)
language sql stable security definer set search_path to 'public' as $$
  with me as (
    select d.artist_id, sc_album_grp(d.album_id, d.title) grp
    from deezer_albums d where d.album_id = p_album and d.kind in ('album', 'ep')
    order by (d.review = 'keep') desc nulls last limit 1
  ),
  g as (
    select distinct on (d.album_id) d.album_id, d.title, d.kind, d.release_date, d.songs,
           sc_album_is_edition(d.album_id, d.title) is_edition
    from deezer_albums d, me
    where d.artist_id = me.artist_id and d.kind in ('album', 'ep') and coalesce(d.review, '') <> 'remove'
      and sc_album_grp(d.album_id, d.title) = me.grp
    order by d.album_id
  )
  select g.*, row_number() over (order by g.is_edition,
           g.is_edition and sc_edition_label(g.title) ~* '(deluxe|expanded|bonus|complete|anniversary|super)',
           g.release_date nulls last, g.songs desc nulls last, g.album_id) = 1
  from g
$$;
revoke execute on function sc_album_group(text) from public, anon, authenticated;

create or replace function rpc_artist_projects(p_artist text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with src as (
    select d.album_id, d.title, d.kind, d.release_date, d.cover, d.songs,
           sc_album_grp(d.album_id, d.title) grp,
           sc_album_is_edition(d.album_id, d.title) is_edition
    from deezer_albums d join artists a on a.id = d.artist_id
    where d.artist_id = p_artist and d.kind in ('album', 'ep')
      and coalesce(d.review, '') <> 'remove' and (d.review = 'keep' or coalesce(a.deezer_check, '') <> 'mixed')
  ),
  al as (
    select distinct on (grp) * from src
    order by grp, is_edition, is_edition and sc_edition_label(title) ~* '(deluxe|expanded|bonus|complete|anniversary|super)',
             release_date nulls last, songs desc nulls last
  ),
  ed as (
    select al.album_id main_id,
           jsonb_agg(jsonb_build_object('id', e.album_id, 'title', e.title, 'label', sc_edition_name(e.album_id, e.title))
                     order by e.release_date nulls last) editions
    from al join (select distinct on (grp, lower(title)) * from src order by grp, lower(title), songs desc nulls last) e
      on e.grp = al.grp and lower(e.title) <> lower(al.title)
    group by al.album_id
  ),
  r as (
    select at.album_id, count(distinct s.track_id) rated, round(avg(s.avg_rating), 1) score
    from album_tracks_eff at join track_rating_stats s on s.track_id = at.track_id
    where at.album_id in (select album_id from al) group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', al.album_id, 'title', al.title, 'kind', al.kind, 'date', al.release_date,
    'cover', al.cover, 'songs', greatest(al.songs, (select max(s2.songs) from src s2 where s2.grp = al.grp)),
    'score', r.score, 'rated', coalesce(r.rated, 0),
    'editions', coalesce(ed.editions, '[]'::jsonb)) order by al.release_date desc nulls last), '[]'::jsonb)
  from al left join r on r.album_id = al.album_id left join ed on ed.main_id = al.album_id;
$function$;

create or replace function rpc_album(p_album text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with grp as (select * from sc_album_group(p_album)),
  m as (select coalesce((select album_id from grp where is_main), p_album) id),
  al as (
    select d.*, a.name artist_name, a.image_url artist_image from deezer_albums d join artists a on a.id = d.artist_id, m
    where d.album_id = m.id order by (d.review = 'keep') desc nulls last, d.songs desc nulls last limit 1
  ),
  main_tl as (select at.* from album_tracks_eff at, m where at.album_id = m.id),
  extra as (
    select x.*, (select coalesce(max(position), 0) from main_tl) + row_number() over (order by x.ord) pos2,
           (select max(disk) from main_tl) disk2
    from (
      select distinct on (sc_title_key(at.title)) at.*, sc_edition_name(g.album_id, g.title) edition,
             row_number() over (order by g.release_date nulls last, g.album_id, at.disk, at.position) ord
      from grp g join album_tracks_eff at on at.album_id = g.album_id, m
      where g.album_id <> m.id
        and (at.track_id is null or at.track_id not in (select track_id from main_tl where track_id is not null))
        and sc_title_key(at.title) not in (select sc_title_key(title) from main_tl)
      order by sc_title_key(at.title), g.release_date nulls last, g.album_id, at.disk, at.position
    ) x
  ),
  tl as (
    select at.disk, at.position, at.title, at.artist, at.duration, at.explicit, at.track_id, null::text edition,
           at.album_id src_album, at.position src_position, coalesce(at.disk, 1) src_disk from main_tl at
    union all
    select e.disk2, e.pos2::int, e.title, e.artist, e.duration, e.explicit, e.track_id, e.edition,
           e.album_id, e.position, coalesce(e.disk, 1) from extra e
  ),
  tl2 as (
    select tl.*, t.title site_title, coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) status,
           t.artist_id, s.avg_rating, coalesce(s.rating_count, 0) rating_count,
           (select count(*) from tracks v where v.parent_track_id = t.id) versions
    from tl left join tracks t on t.id = tl.track_id left join track_rating_stats s on s.track_id = tl.track_id
  ),
  fallback as (
    select null::int disk, t.track_number position, t.title, null::text artist, t.length_sec duration, t.explicit, t.id track_id,
           null::text edition, null::text src_album, null::int src_position, null::int src_disk,
           t.title site_title, coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) status,
           t.artist_id, s.avg_rating, coalesce(s.rating_count, 0) rating_count, 0::bigint versions
    from tracks t join al on t.artist_id = al.artist_id and lower(t.album) = lower(al.title) and t.parent_track_id is null
    left join track_rating_stats s on s.track_id = t.id
    where not exists (select 1 from tl2)
  ),
  rows as (select * from tl2 union all select * from fallback)
  select case when not exists (select 1 from al) then null else jsonb_build_object(
    'id', (select album_id from al), 'title', (select title from al), 'kind', (select kind from al),
    'date', (select release_date from al), 'cover', (select cover from al), 'label', (select label from al),
    'link', (select link from al), 'songs', (select songs from al),
    'artist', jsonb_build_object('id', (select artist_id from al), 'name', (select artist_name from al), 'image', (select artist_image from al)),
    'complete', exists (select 1 from main_tl),
    'length', (select sum(duration) from rows),
    'score', (select round(avg(avg_rating), 1) from rows where avg_rating is not null),
    'rated', (select count(*) from rows where avg_rating is not null),
    'votes', (select coalesce(sum(rating_count), 0) from rows),
    'tracks', (select coalesce(jsonb_agg(to_jsonb(r) order by r.disk nulls first, r.position nulls last, r.title), '[]'::jsonb) from rows r),
    'editions', (select coalesce(jsonb_agg(jsonb_build_object('id', g.album_id, 'title', g.title,
                   'label', case when g.is_main then 'Original' else sc_edition_name(g.album_id, g.title) end,
                   'date', g.release_date, 'songs', g.songs,
                   'extra', (select count(*) from extra e where e.album_id = g.album_id))
                 order by not g.is_main, g.release_date nulls last), '[]'::jsonb)
                 from grp g where (select count(*) from grp) > 1),
    'more', (select coalesce(jsonb_agg(jsonb_build_object('id', x.album_id, 'title', x.title, 'cover', x.cover, 'date', x.release_date, 'kind', x.kind) order by x.release_date desc), '[]'::jsonb)
             from (select distinct on (sc_album_grp(d.album_id, d.title)) d.album_id, d.title, d.cover, d.release_date, d.kind from deezer_albums d, al
                   where d.artist_id = al.artist_id and d.kind in ('album', 'ep') and coalesce(d.review, '') <> 'remove'
                     and d.album_id not in (select album_id from grp) and d.album_id <> al.album_id
                   order by sc_album_grp(d.album_id, d.title), sc_album_is_edition(d.album_id, d.title), d.release_date nulls last) x)
  ) end;
$function$;

create or replace function rpc_track_albums(p_track text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with ids as (select id from tracks where id = p_track union select parent_track_id from tracks where id = p_track and parent_track_id is not null),
  hits as (
    select at.album_id, at.position, at.disk, d.title, d.kind, d.release_date
    from album_tracks_eff at join deezer_albums d on d.album_id = at.album_id
    where at.track_id in (select id from ids) and d.kind in ('album', 'ep') and coalesce(d.review, '') <> 'remove'
  ),
  mapped as (
    select h.*, coalesce((select g.album_id from sc_album_group(h.album_id) g where g.is_main), h.album_id) main_id from hits h
  ),
  x as (
    select distinct on (mp.main_id) mp.main_id id, md.title, md.kind, md.cover, md.release_date date,
           case when mp.album_id = mp.main_id then mp.position end position, mp.disk,
           case when exists (select 1 from mapped z where z.main_id = mp.main_id and z.album_id = z.main_id) then null
                else sc_edition_name(mp.album_id, mp.title) end edition
    from mapped mp join lateral (select * from deezer_albums d where d.album_id = mp.main_id limit 1) md on true
    order by mp.main_id, (mp.album_id = mp.main_id) desc, mp.release_date nulls last
  )
  select coalesce(jsonb_agg(x order by x.date nulls last), '[]'::jsonb) from x;
$function$;

-- ---------- applying an edit ----------
create or replace function sc_album_apply(p_kind text, p_album text, p_artist text, p jsonb, p_by uuid, p_suggestion uuid default null)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_before jsonb; v_id uuid; v_date date; v_kind text; v_other text; v_disk int; v_pos int; v_track text;
begin
  if not exists (select 1 from deezer_albums where album_id = p_album) then raise exception 'unknown album'; end if;
  if p_kind = 'details' then
    select jsonb_build_object('title', title, 'release_date', release_date, 'kind', kind) into v_before
    from deezer_albums where album_id = p_album limit 1;
    begin v_date := nullif(p ->> 'release_date', '')::date; exception when others then raise exception 'release_date must be YYYY-MM-DD'; end;
    v_kind := nullif(p ->> 'kind', '');
    if v_kind is not null and v_kind not in ('album', 'ep') then raise exception 'kind must be album or ep'; end if;
    update deezer_albums set
      title = coalesce(left(nullif(trim(p ->> 'title'), ''), 300), title),
      release_date = coalesce(v_date, release_date),
      kind = coalesce(v_kind, kind)
    where album_id = p_album;
  elsif p_kind = 'not_artist' then
    if p_artist is null then raise exception 'artist needed'; end if;
    select jsonb_build_object('review', review) into v_before from deezer_albums where album_id = p_album and artist_id = p_artist;
    if v_before is null then raise exception 'that album is not on this artist''s page'; end if;
    update deezer_albums set review = 'remove' where album_id = p_album and artist_id = p_artist;
  elsif p_kind in ('same_as', 'not_same') then
    select to_jsonb(l) into v_before from album_links l where l.album_id = p_album;
    if p_kind = 'same_as' then
      v_other := p ->> 'other_album_id';
      if v_other is null or v_other = p_album or not exists (select 1 from deezer_albums where album_id = v_other) then
        raise exception 'pick the other album';
      end if;
      -- Join the other album's group (its main album).
      v_other := coalesce((select g.album_id from sc_album_group(v_other) g where g.is_main), v_other);
      if v_other = p_album then raise exception 'already the same album'; end if;
      insert into album_links (album_id, group_with, not_edition, updated_by) values (p_album, v_other, false, p_by)
      on conflict (album_id) do update set group_with = excluded.group_with, not_edition = false, updated_by = p_by, updated_at = now();
    else
      insert into album_links (album_id, group_with, not_edition, updated_by) values (p_album, null, true, p_by)
      on conflict (album_id) do update set group_with = null, not_edition = true, updated_by = p_by, updated_at = now();
    end if;
  elsif p_kind = 'tracklist' then
    v_disk := coalesce((p ->> 'disk')::int, 1);
    v_pos := (p ->> 'position')::int;
    v_track := nullif(p ->> 'track_id', '');
    if v_pos is null then raise exception 'position needed'; end if;
    if v_track is not null and not exists (select 1 from tracks where id = v_track) then raise exception 'unknown song'; end if;
    select coalesce(to_jsonb(o), '{}'::jsonb) || jsonb_build_object('had_override', o.album_id is not null) into v_before
    from (select 1) one left join album_track_overrides o on o.album_id = p_album and o.disk = v_disk and o.position = v_pos;
    insert into album_track_overrides (album_id, disk, position, track_id, updated_by) values (p_album, v_disk, v_pos, v_track, p_by)
    on conflict (album_id, disk, position) do update set track_id = excluded.track_id, updated_by = p_by, updated_at = now();
  else
    raise exception 'unknown kind';
  end if;
  insert into album_edits (album_id, artist_id, kind, payload, before, suggestion_id, done_by)
  values (p_album, p_artist, p_kind, p, v_before, p_suggestion, p_by) returning id into v_id;
  return v_id;
end $function$;
revoke execute on function sc_album_apply(text, text, text, jsonb, uuid, uuid) from public, anon, authenticated;

-- Suggest (anyone signed in). Moderators' and trusted contributors' apply at once.
create or replace function rpc_suggest_album_edit(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid(); v_id uuid; v_direct boolean;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if (p ->> 'kind') not in ('details', 'not_artist', 'same_as', 'not_same', 'tracklist') then raise exception 'unknown kind'; end if;
  if not exists (select 1 from deezer_albums where album_id = p ->> 'album_id') then raise exception 'unknown album'; end if;
  if exists (select 1 from album_suggestions where album_id = p ->> 'album_id' and kind = p ->> 'kind' and status = 'pending'
             and payload = coalesce(p -> 'payload', '{}'::jsonb)) then
    return jsonb_build_object('ok', true, 'sent', false, 'note', 'The same suggestion is already waiting for review.');
  end if;
  v_direct := current_setting('static_cuts.review_only', true) is distinct from 'on'
              and (is_owner() or is_moderator() or sc_is_trusted(uid));
  insert into album_suggestions (album_id, artist_id, kind, payload, note, source_url, submitted_by, status, reviewed_by, reviewed_at, reviewer_note)
  values (p ->> 'album_id', nullif(p ->> 'artist_id', ''), p ->> 'kind', coalesce(p -> 'payload', '{}'::jsonb),
          left(nullif(trim(p ->> 'note'), ''), 1000), left(nullif(trim(p ->> 'source_url'), ''), 1000), uid,
          case when v_direct then 'approved' else 'pending' end,
          case when v_direct then uid end, case when v_direct then now() end,
          case when v_direct then 'Applied straight away.' end)
  returning id into v_id;
  if v_direct then
    perform sc_album_apply(p ->> 'kind', p ->> 'album_id', nullif(p ->> 'artist_id', ''), coalesce(p -> 'payload', '{}'::jsonb), uid, v_id);
  end if;
  return jsonb_build_object('ok', true, 'sent', true, 'applied', v_direct);
end $function$;
revoke execute on function rpc_suggest_album_edit(jsonb) from public, anon;
grant execute on function rpc_suggest_album_edit(jsonb) to authenticated;

-- ---------- review ----------
create or replace function admin_album_suggestions(p_status text default 'pending')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from album_suggestions group by 1) c),
    'items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) from (
      select s.*, (select d.title from deezer_albums d where d.album_id = s.album_id limit 1) album_title,
             (select d.title from deezer_albums d where d.album_id = s.payload ->> 'other_album_id' limit 1) other_title,
             (select t.title from tracks t where t.id = s.payload ->> 'track_id') track_title,
             a.name artist, (select display_name from profiles where id = s.submitted_by) by_name
      from album_suggestions s left join artists a on a.id = s.artist_id
      where s.status = coalesce(p_status, 'pending') order by s.created_at desc limit 300) x),
    'edits', (select coalesce(jsonb_agg(to_jsonb(x) order by x.done_at desc), '[]'::jsonb) from (
      select e.*, (select d.title from deezer_albums d where d.album_id = e.album_id limit 1) album_title,
             (select display_name from profiles where id = e.done_by) by_name
      from album_edits e order by e.done_at desc limit 50) x));
end $function$;
revoke execute on function admin_album_suggestions(text) from public, anon;
grant execute on function admin_album_suggestions(text) to authenticated;

create or replace function admin_album_suggestion_action(p_id uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare s album_suggestions%rowtype;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  select * into s from album_suggestions where id = p_id and status = 'pending';
  if s.id is null then raise exception 'not waiting for review'; end if;
  if p_action = 'approve' then
    perform sc_album_apply(s.kind, s.album_id, s.artist_id, s.payload, auth.uid(), s.id);
  elsif p_action <> 'reject' then
    raise exception 'unknown action';
  end if;
  update album_suggestions set status = case p_action when 'approve' then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now(), reviewer_note = left(nullif(trim(p_note), ''), 1000)
  where id = p_id;
  return jsonb_build_object('ok', true);
end $function$;
revoke execute on function admin_album_suggestion_action(uuid, text, text) from public, anon;
grant execute on function admin_album_suggestion_action(uuid, text, text) to authenticated;

create or replace function admin_album_undo(p_edit uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare e album_edits%rowtype;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  select * into e from album_edits where id = p_edit and undone_at is null;
  if e.id is null then raise exception 'already undone'; end if;
  if e.kind = 'details' then
    update deezer_albums set title = e.before ->> 'title', release_date = (e.before ->> 'release_date')::date, kind = e.before ->> 'kind'
    where album_id = e.album_id;
  elsif e.kind = 'not_artist' then
    update deezer_albums set review = e.before ->> 'review' where album_id = e.album_id and artist_id = e.artist_id;
  elsif e.kind in ('same_as', 'not_same') then
    if e.before is null then
      delete from album_links where album_id = e.album_id;
    else
      update album_links set group_with = e.before ->> 'group_with', not_edition = (e.before ->> 'not_edition')::boolean, updated_at = now()
      where album_id = e.album_id;
    end if;
  elsif e.kind = 'tracklist' then
    if coalesce((e.before ->> 'had_override')::boolean, false) then
      update album_track_overrides set track_id = e.before ->> 'track_id', updated_at = now()
      where album_id = e.album_id and disk = coalesce((e.payload ->> 'disk')::int, 1) and position = (e.payload ->> 'position')::int;
    else
      delete from album_track_overrides
      where album_id = e.album_id and disk = coalesce((e.payload ->> 'disk')::int, 1) and position = (e.payload ->> 'position')::int;
    end if;
  end if;
  update album_edits set undone_at = now() where id = p_edit;
  return jsonb_build_object('ok', true);
end $function$;
revoke execute on function admin_album_undo(uuid) from public, anon;
grant execute on function admin_album_undo(uuid) to authenticated;
