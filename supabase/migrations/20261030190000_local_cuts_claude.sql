-- Local Cuts: "ask Claude" for files that didn't match cleanly. The
-- local-ai edge function sends Claude the file's title, artist, file name
-- and length plus the closest songs (and their versions) here, and Claude
-- picks the song and version, or says it isn't here and tidies the title
-- (status, version, producers...) for suggesting it as a new song. Only
-- text is sent, never music. Each Claude call takes a ticket from the shared
-- 'claude' allowance, plus a per-person daily limit.

create table if not exists local_ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  calls integer not null default 0,
  primary key (user_id, day)
);
alter table local_ai_usage enable row level security;

-- Take n calls from someone's daily Local Cuts allowance (40 a day: each
-- call covers up to 25 files). Returns how many they got.
create or replace function sc_local_ai_take(p_user uuid, p_calls integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  used int;
  give int;
begin
  insert into local_ai_usage (user_id, day, calls) values (p_user, current_date, 0) on conflict do nothing;
  select calls into used from local_ai_usage where user_id = p_user and day = current_date for update;
  give := greatest(0, least(coalesce(p_calls, 0), 40 - used));
  update local_ai_usage set calls = calls + give where user_id = p_user and day = current_date;
  return give;
end;
$$;
revoke execute on function sc_local_ai_take(uuid, integer) from public, anon, authenticated;

-- For each file: the artist here, and the closest songs by title (noise like
-- [CDQ], (prod. X), V2, leak, snippet taken off first), with all their
-- versions. Items: [{ref, artist, title}]
create or replace function sc_local_candidates(p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $$
declare
  it jsonb;
  v_artist text;
  v_core text;
  v_out jsonb := '[]'::jsonb;
  v_cands jsonb;
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_artist := sc_find_artist(it ->> 'artist');
    if v_artist is null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('ref', it ->> 'ref', 'artist_id', null, 'candidates', '[]'::jsonb));
      continue;
    end if;
    v_core := trim(regexp_replace(regexp_replace(lower(coalesce(it ->> 'title', '')),
      '[\(\[][^\)\]]*[\)\]]', ' ', 'g'),
      '\m(v\d+|cdq|hq|lq|leaked|leak|snippet|final|mastered|og|unreleased|demo|mp3|flac|remaster(ed)?)\M', ' ', 'g'));
    v_core := regexp_replace(v_core, '\s+', ' ', 'g');
    -- Closest songs first; each song's versions follow it.
    with scored as (
      select coalesce(t.parent_track_id, t.id) main,
             greatest(similarity(lower(t.title), v_core), word_similarity(v_core, lower(t.title))) score
      from tracks t
      where t.artist_id = v_artist and v_core <> ''
    ), mains as (
      select main, max(score) score from scored group by main order by 2 desc, 1 limit 6
    ), fam as (
      select t.id, t.title, t.parent_track_id, t.release_status, t.length_sec, t.album, m.score,
             row_number() over (partition by m.main order by (t.parent_track_id is null) desc, t.title, t.id) rn
      from mains m join tracks t on t.id = m.main or t.parent_track_id = m.main
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'version_of', parent_track_id,
             'status', release_status, 'length', length_sec, 'album', album) order by score desc, rn), '[]'::jsonb)
    into v_cands
    from (select * from fam where rn <= 12 order by score desc, rn limit 40) x;
    v_out := v_out || jsonb_build_array(jsonb_build_object('ref', it ->> 'ref', 'artist_id', v_artist,
      'artist_name', (select name from artists where id = v_artist), 'candidates', v_cands));
  end loop;
  return v_out;
end;
$$;
revoke execute on function sc_local_candidates(jsonb) from public, anon, authenticated;

-- New songs from files can now carry a status and a note (what Claude made
-- of "[CDQ] (Leak) V2" and the like). Same as before otherwise.
create or replace function rpc_local_suggest_songs(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  g record;
  v_run uuid;
  v_res jsonb;
  v_suggested int := 0;
  v_skipped int := 0;
begin
  if me is null then raise exception 'not signed in'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 300 then raise exception 'Send at most 300 songs at a time.'; end if;
  if (select coalesce(sum(r.suggested), 0) from import_runs r where r.requested_by = me and r.source = 'local'
      and r.started_at > now() - interval '1 day') > 2000 then
    raise exception 'That''s a lot for one day: try again tomorrow.';
  end if;

  for g in
    select it ->> 'artist_id' artist_id,
           jsonb_agg(jsonb_build_object(
             'title', left(trim(it ->> 'title'), 300),
             'status_guess', case when it ->> 'status' in ('rumored', 'teased', 'snippet', 'leaked', 'announced', 'released')
                                  then it ->> 'status' else 'unconfirmed' end,
             'album', nullif(left(trim(coalesce(it ->> 'album', '')), 200), ''),
             'release_date', case when (it ->> 'release_date') ~ '^\d{4}-\d{2}-\d{2}$' then it ->> 'release_date' end,
             'extra', jsonb_strip_nulls(jsonb_build_object(
               'featuring', nullif(left(trim(coalesce(it ->> 'featuring', '')), 300), ''),
               'producers', nullif(left(trim(coalesce(it ->> 'producers', '')), 300), ''),
               'notes', nullif(left(trim(coalesce(it ->> 'notes', '')), 300), ''),
               'length_sec', case when (it ->> 'length_sec') ~ '^\d{1,5}$' then (it ->> 'length_sec')::int end,
               'from_files', true)))) items
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) it
    where exists (select 1 from artists a where a.id = it ->> 'artist_id')
      and nullif(trim(coalesce(it ->> 'title', '')), '') is not null
    group by 1
  loop
    insert into import_runs (artist_id, source, requested_by) values (g.artist_id, 'local', me) returning id into v_run;
    v_res := sc_import_suggest(v_run, g.items);
    update import_runs set finished_at = now() where id = v_run;
    v_suggested := v_suggested + (v_res ->> 'suggested')::int;
    v_skipped := v_skipped + (v_res ->> 'skipped')::int;
  end loop;
  return jsonb_build_object('suggested', v_suggested, 'skipped', v_skipped);
end;
$$;
revoke execute on function rpc_local_suggest_songs(jsonb) from public, anon;
grant execute on function rpc_local_suggest_songs(jsonb) to authenticated;
