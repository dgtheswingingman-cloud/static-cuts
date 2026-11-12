-- Launch clean-up (control room): the launch artists and what's still
-- missing on their songs, so you know when they're ready to promote.
-- The list lives in launch_artists (cover-search also does them first).

create table if not exists launch_artists (
  artist_id text primary key references artists(id) on delete cascade,
  position int not null default 0,
  added_at timestamptz not null default now()
);
alter table launch_artists enable row level security;
insert into launch_artists (artist_id, position) values
  ('playboi-carti', 1), ('ken-carson', 2), ('destroy-lonely', 3), ('bladee', 4), ('ecco2k', 5),
  ('thaiboy-digital', 6), ('zillakami', 7), ('sosmula', 8), ('city-morgue', 9), ('hxg', 10)
on conflict do nothing;

-- One song's gaps (the same rules for counts and lists).
create or replace function sc_launch_gap(t tracks, p_kind text) returns boolean
language sql immutable as $$
  select case p_kind
    when 'unconfirmed' then t.release_status = 'unconfirmed'
    when 'cover' then t.release_status in ('released', 'leaked', 'snippet') and t.cover_url is null and t.fan_cover_url is null
    when 'leak_date' then t.release_status = 'leaked' and t.leak_date is null
    when 'release_date' then t.release_status = 'released' and t.release_date is null
    when 'album' then t.release_status in ('released', 'leaked', 'snippet') and nullif(trim(t.album), '') is null
    else false end;
$$;

create or replace function admin_launch_health() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(x order by x.position) from (
    select l.position, a.id artist_id, a.name artist, a.image_url photo,
      count(t.id) songs,
      count(t.id) filter (where sc_launch_gap(t, 'unconfirmed')) unconfirmed,
      count(t.id) filter (where sc_launch_gap(t, 'cover')) cover,
      count(t.id) filter (where sc_launch_gap(t, 'leak_date')) leak_date,
      count(t.id) filter (where sc_launch_gap(t, 'release_date')) release_date,
      count(t.id) filter (where sc_launch_gap(t, 'album')) album,
      count(t.id) filter (where not (sc_launch_gap(t, 'unconfirmed') or sc_launch_gap(t, 'cover') or sc_launch_gap(t, 'leak_date')
                                     or sc_launch_gap(t, 'release_date') or sc_launch_gap(t, 'album'))) clean
    from launch_artists l join artists a on a.id = l.artist_id
    left join tracks t on t.artist_id = a.id and t.parent_track_id is null
    group by l.position, a.id) x), '[]');
end $$;

create or replace function admin_launch_gaps(p_artist text, p_kind text, p_limit int default 300) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.release_status, 'album', t.album,
      'release_date', t.release_date, 'leak_date', t.leak_date, 'code', c.code) order by t.release_status, t.title)
    from (select t.* from tracks t where t.artist_id = p_artist and t.parent_track_id is null and sc_launch_gap(t, p_kind)
          order by t.release_status, t.title limit greatest(1, least(p_limit, 1000))) t
    left join track_codes c on c.track_id = t.id), '[]');
end $$;

create or replace function admin_launch_set(p_artist text, p_on boolean) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_on then
    insert into launch_artists (artist_id, position) values (p_artist, coalesce((select max(position) from launch_artists), 0) + 1) on conflict do nothing;
  else
    delete from launch_artists where artist_id = p_artist;
  end if;
end $$;

revoke execute on function admin_launch_health(), admin_launch_gaps(text, text, int), admin_launch_set(text, boolean) from public, anon;
grant execute on function admin_launch_health(), admin_launch_gaps(text, text, int), admin_launch_set(text, boolean) to authenticated;

-- cover-search: launch artists first, from the table.
do $d$
declare src text := pg_get_functiondef('public.sc_cover_search_next(text, int)'::regprocedure); n text;
begin
  n := replace(src, $q$(t.artist_id = any (array['playboi-carti','ken-carson','destroy-lonely','hxg','bladee','ecco2k','thaiboy-digital','zillakami','sosmula','city-morgue'])) desc$q$,
    $q$exists (select 1 from launch_artists l where l.artist_id = t.artist_id) desc$q$);
  if n = src then raise exception 'sc_cover_search_next not patched'; end if;
  execute n;
end $d$;
