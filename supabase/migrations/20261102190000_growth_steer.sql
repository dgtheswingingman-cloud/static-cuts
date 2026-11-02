-- Growth steer (agreed 2 Nov): lean underground.
--  * Artists people search for and can't find jump the queue: any name
--    searched for twice or more becomes a top-priority candidate (checked on
--    Deezer/Genius like any featured artist; a page is made if they're real).
--  * Big names (over a million Deezer fans) aren't banned, just last: they
--    wait unless someone searched for them (guest-artists edge function).

-- Searched-for names: top priority, even with no songs here yet.
create or replace function sc_queue_searched_artists()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n int;
begin
  insert into guest_artists (name_key, name, songs, state, host_weight, note, updated_at)
  select m.query, m.query, 0, 'pending', 1000, 'Searched for ' || m.times || ' times.', now()
  from search_misses m
  where m.kind = 'artists' and m.times >= 2 and length(m.query) between 2 and 60
    and not exists (select 1 from artists a where lower(a.name) = m.query)
    and not exists (select 1 from artist_aliases x where x.alias_key = sc_normalize_title(m.query))
  on conflict (name_key) do update
    set host_weight = greatest(guest_artists.host_weight, 1000),
        checked_at = case when guest_artists.state = 'pending' then null else guest_artists.checked_at end,
        note = excluded.note, updated_at = now()
    where guest_artists.state in ('pending', 'waiting');
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function sc_queue_searched_artists() from public, anon, authenticated;

-- The guest picker: searched-for names count even with no songs here, and
-- say so (the edge function lets them past the big-name wait).
do $do$
declare d text := pg_get_functiondef('sc_guest_next(text,integer)'::regprocedure);
begin
  if position('searched' in d) = 0 then
    if position('where g.state = ''pending'' and g.songs > 0' in d) = 0 or position('''name'', p.name,' in d) = 0 then
      raise exception 'sc_guest_next: anchor not found';
    end if;
    d := replace(d, 'where g.state = ''pending'' and g.songs > 0', 'where g.state = ''pending'' and (g.songs > 0 or g.host_weight >= 1000)');
    d := replace(d, '''name'', p.name,', '''name'', p.name, ''searched'', p.host_weight >= 1000,');
    execute d;
  end if;
end;
$do$;

select cron.schedule('queue-searched-artists', '17 * * * *', 'select sc_queue_searched_artists()');
