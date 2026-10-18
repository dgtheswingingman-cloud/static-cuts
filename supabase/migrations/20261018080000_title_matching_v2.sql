-- Title matching, round two.
--
-- Genius, Last.fm and Spotify write the same song in different ways:
--   "ACT A DAMN FOOL (with Duke Deuce & Slim Guerilla)", "Knotty Head Feat. Rick Ross",
--   "Knotty Head ft. Rick Ross", "Troubles [Feat.T-Pain]", "Dynasties and Dystopia
--   (from the series Arcane League of Legends)", "Walkin (Official Music Video)".
-- Matching now ignores, on top of what it ignored before:
--   feat./ft./featuring with or without brackets or a space after the dot,
--   (with X), "&" vs "and", and video/audio/lyrics/soundtrack notes.
-- More labels count as clear versions: Live At, Sessions, Recorded at,
--   COLORS, Like A Version, Tiny Desk, Spotify Singles, Leak.
--
-- Then it tidies up after the imports: imported songs (Genius / Last.fm, last
-- two days) that turn out to be copies of a song on the same page are merged
-- into it, and versions are linked under their main song. Songs that were on
-- the page before the import are never merged with each other here. Both
-- steps are undoable batches.

create or replace function public.sc_normalize_title(t text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              lower(coalesce(t, '')),
              -- (feat. X) [ft X] (with X) (prod. X) ...
              '\s*[\(\[]\s*(feat\.|ft\.|feat\s|ft\s|featuring\s|with\s|prod\.|prod\s|produced by\s)[^\)\]]*[\)\]]', '', 'g'),
            -- notes that aren't part of the song name
            '\s*[\(\[]\s*(official (music )?video|official audio|official visuali[sz]er|visuali[sz]er|audio|lyric video|lyrics|from the (series|film|movie|game|soundtrack)[^\)\]]*)\s*[\)\]]', '', 'g'),
          -- "Song feat. X" / "Song ft X" without brackets, to the end
          '\s+(feat\.?|ft\.?|featuring)\s.*$', ''),
        '\s*&\s*', ' and ', 'g'),
      '[*''’‘ꞌ"“”.,!?:]+', '', 'g'),
    '\s+', ' ', 'g'));
$$;

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
  -- Drop feat./with/prod. credits (bracketed or not), notes like
  -- "(Official Music Video)", and the trailing "*".
  c := coalesce(p_title, '');
  c := regexp_replace(c, '\s*[\(\[]\s*(feat\.|ft\.|feat\s|ft\s|featuring\s|with\s|prod\.|prod\s|produced by\s)[^\)\]]*[\)\]]', '', 'gi');
  c := regexp_replace(c, '\s*[\(\[]\s*(official (music )?video|official audio|official visuali[sz]er|visuali[sz]er|audio|lyric video|lyrics|from the (series|film|movie|game|soundtrack)[^\)\]]*)\s*[\)\]]', '', 'gi');
  c := regexp_replace(c, '\s+(feat\.?|ft\.?|featuring)\s.*$', '', 'i');
  c := trim(regexp_replace(c, '\*+\s*$', ''));
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
    when v ~ '\m(live|demo|demos|remix|remixed|mix|mixed|instrumental|acapella|a cappella|acoustic|slowed|sped|reverb|remaster|remastered|version|edit|session|sessions|unplugged|rehearsal|alt|alternate|og|original|early|cdq|extended|radio|stripped|rework|bootleg|reprise|reference|ref|snippet|clean|explicit|vocal|vocals|leak|leaked|colors|recorded|tiny desk|spotify singles|v\d+|take \d+)\M'
      then 'sure'
    else 'check'
  end;
end;
$$;

-- The index stores normalised titles, so it has to be rebuilt.
reindex index tracks_artist_title_key_idx;

-- Import review list: also say when a song looks like a version of one
-- already on the page.
drop function if exists admin_import_suggestions(int);
create or replace function admin_import_suggestions(p_limit int default 2000)
returns table (
  id uuid, artist_id text, artist_name text, source text, title text, status_guess text, url text,
  album text, release_date date, main_artist_name text, extra jsonb, created_at timestamptz,
  version_of text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.id, s.artist_id, a.name, s.source, s.title, s.status_guess, s.url, s.album, s.release_date,
         s.main_artist_name, s.extra, s.created_at,
         (select t.title from tracks t where t.id = sc_main_song(s.artist_id, (sc_version_info(s.title)).base))
  from import_suggestions s join artists a on a.id = s.artist_id
  where is_admin() and s.state = 'open'
  order by a.name, s.source, s.title
  limit greatest(1, least(coalesce(p_limit, 2000), 5000));
$$;
revoke execute on function admin_import_suggestions(int) from public, anon;
grant execute on function admin_import_suggestions(int) to authenticated;

-- Approving an imported song keeps the guests the source listed.
create or replace function admin_apply_import_suggestions(p_ids uuid[], p_status text default null)
returns int
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  s import_suggestions%rowtype;
  v_id text;
  v_main text;
  v_home text;
  n int := 0;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_status is not null and p_status not in ('unconfirmed', 'rumored', 'teased', 'snippet', 'leaked', 'announced', 'released') then
    raise exception 'unknown status';
  end if;
  perform sc_begin_batch('import', 'Import review: ' || coalesce(array_length(p_ids, 1), 0) || ' approved');
  perform set_config('static_cuts.skip_status_log', 'on', true);
  for s in select * from import_suggestions where id = any (p_ids[1:300]) and state = 'open' order by title loop
    if exists (select 1 from sc_known_keys(s.artist_id) k where k.k = sc_title_key(s.title)) then
      update import_suggestions set state = 'dismissed', decided_at = now() where id = s.id;
      continue;
    end if;
    v_main := case when s.main_artist_name is not null then sc_find_artist(s.main_artist_name) end;
    v_home := coalesce(v_main, s.artist_id);
    v_id := v_home || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    insert into tracks (id, artist_id, title, release_status, album, release_date, is_featured, featured_artists,
                        source, source_url, notes)
    values (v_id, v_home, s.title, coalesce(p_status, s.status_guess), s.album, s.release_date,
            v_main is null and s.main_artist_name is not null,
            nullif(s.extra ->> 'featuring', ''),
            s.source, s.url,
            case when v_main is null and s.main_artist_name is not null
                 then 'Feature on ' || s.main_artist_name || '''s song.' end);
    if v_main is not null then
      insert into track_appearances (track_id, artist_id) values (v_id, s.artist_id) on conflict do nothing;
    end if;
    update import_suggestions set state = 'applied', decided_at = now() where id = s.id;
    n := n + 1;
  end loop;
  return n;
end;
$fn$;

-- Open suggestions whose song is now recognised as already on the page.
update import_suggestions s set state = 'dismissed', decided_at = now()
where s.state = 'open'
  and exists (select 1 from sc_known_keys(s.artist_id) k where k.k = sc_title_key(s.title));
update import_suggestions s set title_key = sc_title_key(s.title)
where s.title_key <> sc_title_key(s.title)
  and not exists (select 1 from import_suggestions o
                  where o.artist_id = s.artist_id and o.title_key = sc_title_key(s.title) and o.id <> s.id);

-- ---------------------------------------------------------------------------
-- Tidy up after the imports
-- ---------------------------------------------------------------------------

do $$
declare
  g record;
  v_keep text;
  v_dups text[];
begin
  -- Act as the admin so the merge function can run from the SQL editor.
  perform set_config('request.jwt.claims', '{"email":"dg.theswingingman@gmail.com","role":"authenticated"}', true);
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('tidy', 'Imported duplicates merged');

  for g in
    select t.artist_id, sc_title_key(t.title) k
    from tracks t
    where t.parent_track_id is null
      and t.artist_id in (select distinct artist_id from tracks where source in ('genius', 'lastfm'))
    group by 1, 2
    having count(*) > 1
       and bool_or(t.source in ('genius', 'lastfm') and t.created_at > now() - interval '2 days')
  loop
    -- Keep: a song that was here before, then Spotify, then Genius (cleaner
    -- titles), then the oldest.
    select id into v_keep from tracks t
    where t.artist_id = g.artist_id and t.parent_track_id is null and sc_title_key(t.title) = g.k
    order by (t.source is null or t.source = 'spotify') desc, (t.spotify_url is null), (t.source = 'genius') desc,
             t.created_at nulls first, t.id
    limit 1;
    -- Merge away only freshly imported copies with nothing attached to them.
    select array_agg(t.id) into v_dups from tracks t
    where t.artist_id = g.artist_id and t.parent_track_id is null and sc_title_key(t.title) = g.k
      and t.id <> v_keep
      and t.source in ('genius', 'lastfm') and t.created_at > now() - interval '2 days'
      and not exists (select 1 from ratings r where r.track_id = t.id)
      and not exists (select 1 from track_ownership o where o.track_id = t.id)
      and not exists (select 1 from comments c where c.track_id = t.id);
    if v_dups is not null then
      perform admin_merge_duplicates(v_keep, v_dups);
    end if;
  end loop;
end $$;

do $$
declare
  v_ids uuid[];
  v_artists text[];
begin
  select array_agg(distinct artist_id) into v_artists from tracks where source in ('genius', 'lastfm', 'spotify');
  -- Earlier suggestions for these songs were made with the old matching.
  delete from version_suggestions vs using tracks t
  where t.id = vs.track_id and vs.state = 'open' and t.artist_id = any (v_artists);
  perform sc_scan_versions(v_artists);
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('sub_versions', 'Sub-versions after imports');
  select array_agg(id) into v_ids from version_suggestions where state = 'open' and cls = 'sure';
  perform sc_apply_version_suggestions(coalesce(v_ids, '{}'));
end $$;

select b.label, (select count(*) from change_log l where l.batch_id = b.id) as changes
from change_batches b where b.created_at > now() - interval '5 minutes' order by b.created_at;
