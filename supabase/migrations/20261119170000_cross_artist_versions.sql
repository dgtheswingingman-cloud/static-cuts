-- Archive checks: sub-versions filed under a different artist's song with
-- nothing linking the two (the other artist isn't in the title, features,
-- producers or credits either way). Mostly it's two different songs that
-- share a title (Yeat "My Way" under Lil Tecca "My Way") or a generic
-- "Intro". 'Own song' unlinks it from the main song (one Undo entry);
-- 'fine' keeps it and hides it for good.

create table if not exists cross_version_ok (
  track_id text primary key references tracks(id) on delete cascade,
  decided_by uuid default auth.uid(),
  decided_at timestamptz not null default now()
);
alter table cross_version_ok enable row level security;
revoke all on table cross_version_ok from anon, authenticated;

create or replace function admin_cross_versions()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  select case when not is_admin() then null else coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'title', c.title, 'artist_id', c.artist_id, 'artist', ca.name, 'status', c.release_status,
      'parent_id', p.id, 'parent_title', p.title, 'parent_artist_id', p.artist_id, 'parent_artist', pa.name) order by ca.name, c.title)
    from tracks c join tracks p on p.id = c.parent_track_id and p.artist_id <> c.artist_id
    join artists ca on ca.id = c.artist_id join artists pa on pa.id = p.artist_id
    where not exists (select 1 from cross_version_ok k where k.track_id = c.id)
      and position(lower(pa.name) in lower(coalesce(c.title, '') || ' ' || coalesce(c.featured_artists, '') || ' ' || coalesce(c.producers, ''))) = 0
      and position(lower(ca.name) in lower(coalesce(p.title, '') || ' ' || coalesce(p.featured_artists, '') || ' ' || coalesce(p.producers, ''))) = 0
      and not exists (select 1 from track_appearances ap where ap.track_id = c.id and ap.artist_id = p.artist_id)
      and not exists (select 1 from track_appearances ap where ap.track_id = p.id and ap.artist_id = c.artist_id)
  ), '[]'::jsonb) end;
$$;

create or replace function admin_cross_version_action(p_track text, p_action text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_parent text; v_title text;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_action = 'fine' then
    insert into cross_version_ok (track_id) values (p_track) on conflict do nothing;
    return 'kept';
  elsif p_action = 'own' then
    select parent_track_id, title into v_parent, v_title from tracks where id = p_track;
    if v_parent is null then return 'already its own song'; end if;
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('versions', left('Made its own song: ' || v_title, 200));
    update tracks set parent_track_id = null where id = p_track;
    return 'unlinked';
  end if;
  raise exception 'own or fine';
end $$;

revoke execute on function admin_cross_versions() from public, anon;
revoke execute on function admin_cross_version_action(text, text) from public, anon;
grant execute on function admin_cross_versions() to authenticated;
grant execute on function admin_cross_version_action(text, text) to authenticated;
