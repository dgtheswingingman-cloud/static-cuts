-- Tracker eras saved as albums on released songs.
-- Sheets file songs under an era ("Before The College Dropout"), which is a
-- good album for unreleased songs but wrong for released ones. Some names
-- that look like eras are real mixtapes that just aren't on streaming
-- services, so nothing is changed automatically: an admin decides once per
-- album name. "keep" hides it for good; "clear" blanks the album on that
-- artist's released songs only (unreleased songs keep the era), as one
-- entry in Undo.

create table if not exists era_album_decisions (
  artist_id text not null references artists(id) on delete cascade,
  album text not null,
  decision text not null check (decision in ('keep', 'clear')),
  songs_changed int not null default 0,
  decided_by uuid default auth.uid(),
  decided_at timestamptz not null default now(),
  primary key (artist_id, album)
);
alter table era_album_decisions enable row level security;
-- Read and written only through the admin functions below.

-- The list: album names used by 3+ of an artist's unreleased songs and also
-- on their released songs, that don't match any real release of theirs on
-- Deezer, Spotify or Apple, and haven't been decided yet.
create or replace function admin_era_albums()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  with official as (
    select artist_id, lower(regexp_replace(title, '\s*[\(\[].*$', '')) t from deezer_albums
    union select artist_id, lower(regexp_replace(name, '\s*[\(\[].*$', '')) from spotify_albums
    union select artist_id, lower(regexp_replace(title, '\s*[\(\[].*$', '')) from apple_albums),
  eras as (
    select artist_id, album, count(*) unreleased from tracks
    where album is not null and coalesce(release_status, 'unconfirmed') <> 'released'
    group by 1, 2 having count(*) >= 3),
  hit as (
    select t.id, t.title, t.artist_id, t.album, t.source, e.unreleased
    from tracks t join eras e on e.artist_id = t.artist_id and e.album = t.album
    where t.release_status = 'released' and t.parent_track_id is null
      and not exists (select 1 from official o where o.artist_id = t.artist_id
                      and o.t = lower(regexp_replace(t.album, '\s*[\(\[].*$', '')))
      and not exists (select 1 from era_album_decisions d where d.artist_id = t.artist_id and d.album = t.album)),
  groups as (
    select h.artist_id, a.name artist, h.album, count(*) released, max(h.unreleased) unreleased,
           (array_agg(h.title order by h.title))[1:4] examples,
           array_agg(distinct coalesce(h.source, 'unknown')) sources
    from hit h join artists a on a.id = h.artist_id
    group by h.artist_id, a.name, h.album)
  select case when not is_admin() then null else coalesce(
    (select jsonb_agg(to_jsonb(g) order by g.released desc, g.artist, g.album) from groups g), '[]'::jsonb) end;
$$;

create or replace function admin_era_album_decide(p_artist text, p_album text, p_decision text)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare n int := 0;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_decision not in ('keep', 'clear') then raise exception 'keep or clear'; end if;
  if p_decision = 'clear' then
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('eras', left('Era cleared from released songs: ' || p_album, 200));
    update tracks set album = null
    where artist_id = p_artist and album = p_album and release_status = 'released' and parent_track_id is null;
    get diagnostics n = row_count;
  end if;
  insert into era_album_decisions (artist_id, album, decision, songs_changed)
  values (p_artist, p_album, p_decision, n)
  on conflict (artist_id, album) do update
    set decision = excluded.decision, songs_changed = excluded.songs_changed, decided_by = auth.uid(), decided_at = now();
  return n;
end $$;

revoke all on table era_album_decisions from anon, authenticated;
revoke execute on function admin_era_albums() from public, anon;
revoke execute on function admin_era_album_decide(text, text, text) from public, anon;
grant execute on function admin_era_albums() to authenticated;
grant execute on function admin_era_album_decide(text, text, text) to authenticated;
