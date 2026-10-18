-- The same version written two ways: "Angelz (Live At Electric Lady)" and
-- "Angelz - Live At Electric Lady", "DIET_ (Instrumental)" and
-- "DIET_ - Instrumental". sc_song_key() gives both the same key: the song
-- plus its version label, ignoring brackets vs dashes.
--
-- Imports now treat those as already on the page, and freshly imported
-- copies are merged into the one that was there first (same rules as before:
-- only Genius/Last.fm imports from the last two days, never anything rated,
-- collected or commented). Undoable batch.

create or replace function sc_song_key(p_title text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when (sc_version_info(p_title)).base is not null
      then sc_title_key((sc_version_info(p_title)).base) || '(' || sc_title_key((sc_version_info(p_title)).version) || ')'
    else sc_title_key(p_title)
  end;
$$;

-- "Already on the page" checks now also match on the song key.
create or replace function sc_known_keys(p_artist_id text)
returns table (k text, track_id text, spotify_url text, album text, release_date date)
language sql
stable
security definer
set search_path to 'public'
as $$
  with mine as (
    select tr.* from tracks tr
    where tr.artist_id = p_artist_id
       or exists (select 1 from track_appearances a where a.track_id = tr.id and a.artist_id = p_artist_id)
  )
  select sc_title_key(m.title), m.id, m.spotify_url, m.album, m.release_date from mine m
  union all
  select sc_song_key(m.title), m.id, m.spotify_url, m.album, m.release_date from mine m
  where sc_song_key(m.title) <> sc_title_key(m.title)
  union all
  select sc_title_key(al), m.id, m.spotify_url, m.album, m.release_date
  from mine m, regexp_split_to_table(coalesce(m.aliases, ''), '\s*[,;/\n]\s*') al
  where al <> '';
$$;
revoke execute on function sc_known_keys(text) from public, anon, authenticated;

-- New suggestions are also checked by song key (sc_import_suggest and the
-- Spotify import look keys up in sc_known_keys, so they pick this up; their
-- own lookups use sc_title_key of the incoming title, so add the song key).
create or replace function sc_import_suggest(p_run uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r import_runs%rowtype;
  it jsonb;
  v_key text;
  v_song text;
  v_suggested int := 0;
  v_skipped int := 0;
begin
  select * into r from import_runs where id = p_run;
  if r.id is null or r.finished_at is not null then raise exception 'import run not active'; end if;

  create temp table if not exists _sc_known2 (k text) on commit drop;
  truncate _sc_known2;
  insert into _sc_known2 select k from sc_known_keys(r.artist_id);
  insert into _sc_known2
  select sc_title_key(d.title || coalesce(' (' || d.version_hint || ')', ''))
  from discoveries d where (d.artist_id = r.artist_id or d.main_artist_id = r.artist_id) and d.state = 'open';
  insert into _sc_known2
  select sc_song_key(d.title || coalesce(' (' || d.version_hint || ')', ''))
  from discoveries d where (d.artist_id = r.artist_id or d.main_artist_id = r.artist_id) and d.state = 'open';

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_key := sc_title_key(it ->> 'title');
    v_song := sc_song_key(it ->> 'title');
    if v_key is null or v_key = ''
       or exists (select 1 from _sc_known2 where k in (v_key, v_song)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into import_suggestions (run_id, artist_id, source, title, title_key, status_guess, url, album,
                                    release_date, main_artist_name, extra)
    values (
      p_run, r.artist_id, r.source, it ->> 'title', v_key,
      case when it ->> 'status_guess' in ('unconfirmed', 'rumored', 'teased', 'snippet', 'leaked', 'announced', 'released')
           then it ->> 'status_guess' else 'unconfirmed' end,
      nullif(it ->> 'url', ''), nullif(it ->> 'album', ''), nullif(it ->> 'release_date', '')::date,
      nullif(it ->> 'main_artist_name', ''), coalesce(it -> 'extra', '{}'::jsonb))
    on conflict (artist_id, title_key) do nothing;
    if found then v_suggested := v_suggested + 1; else v_skipped := v_skipped + 1; end if;
    insert into _sc_known2 values (v_key), (v_song);
  end loop;

  update import_runs set suggested = suggested + v_suggested, skipped = skipped + v_skipped where id = p_run;
  return jsonb_build_object('suggested', v_suggested, 'skipped', v_skipped);
end;
$$;
revoke execute on function sc_import_suggest(uuid, jsonb) from public, anon, authenticated;
grant execute on function sc_import_suggest(uuid, jsonb) to service_role;

-- Open suggestions that are now recognised as already on the page.
update import_suggestions s set state = 'dismissed', decided_at = now()
where s.state = 'open'
  and exists (select 1 from sc_known_keys(s.artist_id) k where k.k = sc_song_key(s.title));

-- Merge the freshly imported copies.
do $$
declare
  g record;
  v_keep text;
  v_dups text[];
begin
  perform set_config('request.jwt.claims', '{"email":"dg.theswingingman@gmail.com","role":"authenticated"}', true);
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('tidy', 'Same version written two ways, merged');

  for g in
    select t.artist_id, sc_song_key(t.title) k
    from tracks t
    where t.artist_id in (select distinct artist_id from tracks where source in ('genius', 'lastfm'))
    group by 1, 2
    having count(*) > 1
       and bool_or(t.source in ('genius', 'lastfm') and t.created_at > now() - interval '2 days')
  loop
    select id into v_keep from tracks t
    where t.artist_id = g.artist_id and sc_song_key(t.title) = g.k
    order by (t.source is null or t.source = 'spotify') desc, (t.spotify_url is null), (t.source = 'genius') desc,
             (t.parent_track_id is not null) desc, t.created_at nulls first, t.id
    limit 1;
    select array_agg(t.id) into v_dups from tracks t
    where t.artist_id = g.artist_id and sc_song_key(t.title) = g.k
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

select b.label, (select count(*) from change_log l where l.batch_id = b.id and l.table_name = 'tracks' and l.op = 'DELETE') as songs_merged
from change_batches b where b.created_at > now() - interval '5 minutes' order by b.created_at;
