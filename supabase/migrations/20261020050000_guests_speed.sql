-- The guest artists list timed out once the Kid Cudi import brought ~1,000
-- guests: it searched every song once per guest. Now an index on the guest
-- name, and the list reads the feature songs once.
create index if not exists tracks_guest_name_idx on tracks (lower(sc_guest_name(notes))) where notes like 'Feature on %';

create or replace function admin_guest_artists()
returns table (name_key text, name text, songs int, state text, note text, sample text[])
language sql
stable
security definer
set search_path to 'public'
as $$
  with f as (
    select lower(sc_guest_name(t.notes)) k, a.name || ': ' || t.title x, t.id
    from tracks t join artists a on a.id = t.artist_id
    where t.notes like 'Feature on %'
  ), s as (
    select k, (array_agg(x order by id))[1:3] sample from f group by k
  )
  select g.name_key, g.name, g.songs, g.state, g.note, s.sample
  from guest_artists g left join s on s.k = g.name_key
  where is_moderator() and g.songs > 0 and g.state in ('review', 'pending')
  order by (g.state = 'review') desc, g.songs desc, g.name;
$$;

select count(*) as guests_waiting from guest_artists where songs > 0 and state in ('review', 'pending');
