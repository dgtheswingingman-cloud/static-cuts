-- Launch clean-up: unconfirmed songs that look like a copy of another song by
-- the same artist get a "twin" (shown on /review/launch with a merge button,
-- which uses the undoable admin_merge_duplicates). Only tight matches:
--   same:  the same title once punctuation is gone, or with lookalike
--          characters swapped back ($ -> s, 0 -> o, 3 -> e ...)
--   spell: 8+ letters and one letter off (two for 12+), same numbers and
--          the same [version] tags
--   alt:   one title is the other's name in brackets ("Wicked (Killers)" /
--          "Killers"), but not (Remix), (Demo), (Live) and the like
create extension if not exists fuzzystrmatch with schema extensions;

create or replace function sc_lookalike_key(k text) returns text
language sql immutable set search_path to 'public' as $$
  select translate(k, '$013457@!', 'soieastai')
$$;

create or replace function admin_launch_gaps(p_artist text, p_kind text, p_limit integer default 300)
returns jsonb language plpgsql stable security definer set search_path to 'public' set statement_timeout to '20s' as $function$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_kind <> 'unconfirmed' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.release_status, 'album', t.album,
        'release_date', t.release_date, 'leak_date', t.leak_date, 'code', c.code) order by t.release_status, t.title)
      from (select t.* from tracks t where t.artist_id = p_artist and t.parent_track_id is null and sc_launch_gap(t, p_kind)
            order by t.release_status, t.title limit greatest(1, least(p_limit, 1000))) t
      left join track_codes c on c.track_id = t.id), '[]');
  end if;
  return coalesce((
    with o as materialized (
      select x.*, sc_lookalike_key(x.k) lk, regexp_replace(x.k, '\D', '', 'g') nums,
             coalesce(substring(x.k from '\[.*\]'), '') tags, length(x.k) len
      from (select t.id, t.title, t.release_status st, sc_title_key(t.title) k,
                   nullif(sc_title_key(substring(t.title from '\(([^)]+)\)')), '') alt
            from tracks t where t.artist_id = p_artist and t.parent_track_id is null) x),
    g as materialized (
      select t.* from tracks t where t.artist_id = p_artist and t.parent_track_id is null and sc_launch_gap(t, 'unconfirmed')
      order by t.title limit greatest(1, least(p_limit, 1000))),
    u as materialized (select o.* from o join g on g.id = o.id),
    -- Candidates found by lookups (fast), then the best one per song.
    cand as (
      select u.id uid, o.id, o.title, o.st, 'same' why, 0 rank, abs(u.len - o.len) d from u join o on o.k = u.k and o.id <> u.id where u.len >= 2
      union all
      select u.id, o.id, o.title, o.st, 'same', 1, abs(u.len - o.len) from u join o on o.lk = u.lk and o.k <> u.k and o.id <> u.id where u.len >= 4
      union all
      select u.id, o.id, o.title, o.st, 'alt', 2, 0 from u join o on (o.k = u.alt or o.alt = u.k) and o.id <> u.id
        where u.len >= 4 and o.len >= 4
          and coalesce(case when o.k = u.alt then u.alt else o.alt end, '')
              !~ '^(remix|demo|live|freestyle|interlude|intro|outro|extended|og|version|snippet|slowed|spedup|instrumental|v\d+|clean|explicit|acoustic|reprise)'
      union all
      select u.id, o.id, o.title, o.st, 'spell', 3, abs(u.len - o.len) from u join o on o.nums = u.nums and o.tags = u.tags and o.id <> u.id
        where u.len >= 8 and o.len >= 8 and abs(u.len - o.len) <= 2 and o.k <> u.k
          and extensions.levenshtein(u.k, o.k) <= case when u.len >= 12 then 2 else 1 end),
    best as (
      select distinct on (uid) * from cand order by uid, rank, (st <> 'unconfirmed') desc, d, id)
    select jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'status', g.release_status, 'album', g.album,
        'release_date', g.release_date, 'leak_date', g.leak_date, 'code', c.code,
        'twin', case when w.id is not null then jsonb_build_object('id', w.id, 'title', w.title, 'status', w.st, 'why', w.why) end)
      order by (w.id is null), g.title)
    from g
    left join track_codes c on c.track_id = g.id
    left join best w on w.uid = g.id), '[]');
end $function$;
