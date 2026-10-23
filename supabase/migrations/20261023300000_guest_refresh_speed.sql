-- guest-artists had been timing out every run since about 23:30 on 22 Oct.
-- Imports added ~27,000 "Feature on …" songs, and sc_guest_refresh checked
-- every guest against all of them one by one (37 seconds; the limit is 8).
-- Now the current guest names are worked out once, and songs are moved to
-- guests' new pages a few guests per run (the newly approved artists left a
-- backlog of ~1,650 songs to move; it clears over the next few hours).

create or replace function sc_guest_refresh()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g record;
  n int := 0;
begin
  insert into guest_artists (name_key, name, songs)
  select lower(nm), min(nm), count(*)
  from (select sc_guest_name(notes) nm from tracks where notes like 'Feature on %') x
  where nm is not null and nm <> ''
  group by lower(nm)
  on conflict (name_key) do update set songs = excluded.songs, updated_at = now()
  where guest_artists.songs is distinct from excluded.songs;

  with cur as materialized (
    select distinct lower(sc_guest_name(notes)) k from tracks where notes like 'Feature on %'
  )
  update guest_artists ga set songs = 0
  where ga.songs > 0 and not exists (select 1 from cur where cur.k = ga.name_key);

  -- Guests whose name is an artist here, or one of their nicknames.
  update guest_artists ga set artist_id = m.id, state = 'linked', checked_at = now(), note = null
  from (
    select g2.name_key, coalesce(a.id, al.artist_id) as id
    from guest_artists g2
    left join (select id, sc_normalize_title(name) k from artists) a on a.k = sc_normalize_title(g2.name)
    left join artist_aliases al on al.alias_key = sc_normalize_title(g2.name)
    where g2.songs > 0 and g2.artist_id is null and g2.state in ('pending', 'review') and sc_normalize_title(g2.name) <> ''
  ) m
  where m.name_key = ga.name_key and m.id is not null;

  -- Move their songs over, a few guests per run.
  for g in select * from guest_artists where artist_id is not null and songs > 0 order by songs desc limit 8 loop
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('guests', 'Songs moved to ' || g.name || '''s page');
    n := n + sc_guest_move(g.name_key, g.artist_id);
    update guest_artists set songs = 0 where name_key = g.name_key;
  end loop;
  return n;
end;
$$;
revoke execute on function sc_guest_refresh() from public, anon, authenticated;
