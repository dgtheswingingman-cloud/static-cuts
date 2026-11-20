-- NIX consolidation, step 1 (Nathan, 20 Nov): make the heavy jobs cheap.

-- Review counts ran a title check on all ~540k songs every 15 minutes
-- (13.5 s each time) to find the ~750 that need clean-up. This index keeps
-- that short list, so the count (and the Clean-up page) reads only those.
create index if not exists tracks_cleanup_kind_idx
  on public.tracks ((sc_cleanup_kind(title)))
  where parent_track_id is null and sc_cleanup_kind(title) is not null;

-- Top contributors took 8 s every 10 minutes for a list that changes slowly:
-- hourly is plenty.
select cron.alter_job((select jobid from cron.job where jobname = 'top-contributors'), schedule := '11 * * * *');

-- Guest refresh moves "Feature on X's song" songs onto X's page once X has
-- one. The 20 Nov relabel ("Produced for X." etc.) hid 7,407 songs from it.
-- The real artist now lives in its own field, tracks.credit_for, and guest
-- refresh / sc_guest_move read it too. When X gets a page, the song moves
-- there (and stops being credited as the producer's / label's / writer's).
alter table public.tracks add column if not exists credit_for text;

update public.tracks t set credit_for = coalesce(
    (select s.main_artist_name from import_suggestions s
      where s.state = 'applied' and s.artist_id = t.artist_id and s.title_key = sc_title_key(t.title)
        and s.main_artist_name is not null limit 1),
    substring(t.notes from '^Produced for (.+)\.$'),
    substring(t.notes from '^A song by (.+), (?:released on|written by) .+\.$'))
where t.credit_role is not null and t.credit_for is null;

create index if not exists tracks_credit_for_idx on public.tracks (lower(credit_for)) where credit_for is not null;

do $patch$
declare d text;
begin
  -- Guest refresh: count credit_for songs as well as "Feature on" notes.
  d := pg_get_functiondef('public.sc_guest_refresh()'::regprocedure);
  if position($o$(select sc_guest_name(notes) nm, artist_id from tracks where notes like 'Feature on %') x$o$ in d) = 0 then
    raise exception 'sc_guest_refresh: anchor not found';
  end if;
  execute replace(d, $o$(select sc_guest_name(notes) nm, artist_id from tracks where notes like 'Feature on %') x$o$,
    $n$(select coalesce(sc_guest_name(notes), credit_for) nm, artist_id from tracks where notes like 'Feature on %' or credit_for is not null) x$n$);
end $patch$;

-- The move: features as before; produced / released / written songs move
-- to their real artist too, keeping the producer in "Produced by".
create or replace function public.sc_guest_move(p_key text, p_artist text)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare t record; n int := 0;
begin
  for t in select id, artist_id, notes from tracks where notes like 'Feature on %' and lower(sc_guest_name(notes)) = p_key loop
    update tracks set artist_id = p_artist, is_featured = false,
      notes = nullif(trim(regexp_replace(notes, '(^|\n)Feature on .+?''s song\.', '', 'g')), '')
    where id = t.id;
    if t.artist_id <> p_artist then
      insert into track_appearances (track_id, artist_id) values (t.id, t.artist_id) on conflict do nothing;
    end if;
    n := n + 1;
  end loop;
  for t in select id from tracks where credit_for is not null and lower(credit_for) = p_key loop
    update tracks set artist_id = p_artist, is_featured = false, credit_role = null, credit_for = null,
      notes = nullif(trim(regexp_replace(notes, '^(Produced for .+\.|A song by .+, (released on|written by) .+\.)', '')), '')
    where id = t.id;
    n := n + 1;
  end loop;
  return n;
end $function$;

-- New imports with a credit role keep their real artist in credit_for too.
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.admin_apply_import_suggestions(uuid[], text)'::regprocedure);
  if position('update tracks t set credit_role = r.role,' in d) = 0 then raise exception 'import apply: anchor not found'; end if;
  execute replace(d, 'update tracks t set credit_role = r.role,', 'update tracks t set credit_role = r.role, credit_for = s.main_artist_name,');
end $patch$;
