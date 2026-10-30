-- Local Cuts, the other way round: people's own (already tidy) music files
-- can fill gaps in the archive. Nothing is overwritten: every suggestion is
-- reviewed first, and on approval only fields that are still empty are
-- filled. Songs the archive doesn't have go on the imported-songs list.

-- Song length (from people's files; helps tell versions apart).
alter table tracks add column if not exists length_sec integer;
alter table tracks add constraint tracks_length_sec_check check (length_sec is null or length_sec between 1 and 36000) not valid;

-- Cover art from people's files: shrunk on their device, stored here, only
-- shown on the site once approved.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "Public can view covers" on storage.objects for select using (bucket_id = 'covers');
create policy "Signed-in users upload covers from their files" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = 'local' and (storage.foldername(name))[2] = auth.uid()::text);

-- "Imported songs" can now come from people's files.
alter table import_runs drop constraint if exists import_runs_source_check;
alter table import_runs add constraint import_runs_source_check
  check (source = any (array['spotify', 'genius', 'lastfm', 'sheet', 'local']));

-- Details from someone's files for songs already here: empty fields only.
-- Items: [{track_id, album, release_date, track_number, producers,
--          featured_artists, length_sec, cover_url}]
create or replace function rpc_local_suggest_details(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  it jsonb;
  t tracks%rowtype;
  v jsonb;
  v_date date;
  v_len int;
  v_cover_prefix text := 'https://pcuyzaamcsegblrauxsa.supabase.co/storage/v1/object/public/covers/local/' || me::text || '/';
  v_sent int := 0;
  v_nothing int := 0;
  v_waiting int := 0;
begin
  if me is null then raise exception 'not signed in'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 200 then raise exception 'Send at most 200 songs at a time.'; end if;
  if (select count(*) from submissions where submitted_by = me and type = 'correction' and payload ->> 'from' = 'local'
      and created_at > now() - interval '1 day') > 3000 then
    raise exception 'That''s a lot for one day: try again tomorrow.';
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into t from tracks where id = it ->> 'track_id';
    if t.id is null then v_nothing := v_nothing + 1; continue; end if;
    v := '{}'::jsonb;
    if t.album is null and nullif(trim(it ->> 'album'), '') is not null then v := v || jsonb_build_object('album', left(trim(it ->> 'album'), 200)); end if;
    if t.producers is null and nullif(trim(it ->> 'producers'), '') is not null then v := v || jsonb_build_object('producers', left(trim(it ->> 'producers'), 300)); end if;
    if t.featured_artists is null and nullif(trim(it ->> 'featured_artists'), '') is not null then v := v || jsonb_build_object('featured_artists', left(trim(it ->> 'featured_artists'), 300)); end if;
    if t.track_number is null and (it ->> 'track_number') ~ '^\d{1,3}$' and (it ->> 'track_number')::int between 1 and 300 then
      v := v || jsonb_build_object('track_number', it ->> 'track_number');
    end if;
    if t.release_date is null and (it ->> 'release_date') ~ '^\d{4}-\d{2}-\d{2}$' then
      begin
        v_date := (it ->> 'release_date')::date;
        if extract(year from v_date) between 1900 and extract(year from now()) + 1 then v := v || jsonb_build_object('release_date', v_date::text); end if;
      exception when others then null;
      end;
    end if;
    if t.length_sec is null and (it ->> 'length_sec') ~ '^\d{1,5}$' then
      v_len := (it ->> 'length_sec')::int;
      if v_len between 1 and 36000 then v := v || jsonb_build_object('length_sec', v_len); end if;
    end if;
    if t.cover_url is null and left(coalesce(it ->> 'cover_url', ''), length(v_cover_prefix)) = v_cover_prefix
       and (it ->> 'cover_url') ~ '\.(jpg|jpeg|png|webp)$' then
      v := v || jsonb_build_object('cover_url', it ->> 'cover_url');
    end if;
    if v = '{}'::jsonb then v_nothing := v_nothing + 1; continue; end if;
    -- One waiting suggestion from files per song is enough.
    if exists (select 1 from submissions where type = 'correction' and status = 'pending'
               and payload ->> 'track_id' = t.id and payload ->> 'from' = 'local') then
      v_waiting := v_waiting + 1; continue;
    end if;
    insert into submissions (type, artist_id, payload, submitted_by)
    values ('correction', t.artist_id, v || jsonb_build_object('track_id', t.id, 'from', 'local'), me);
    v_sent := v_sent + 1;
  end loop;
  return jsonb_build_object('sent', v_sent, 'nothing_new', v_nothing, 'already_waiting', v_waiting);
end;
$$;
revoke execute on function rpc_local_suggest_details(jsonb) from public, anon;
grant execute on function rpc_local_suggest_details(jsonb) to authenticated;

-- Songs from someone's files that the archive doesn't have: onto the
-- imported-songs list for review (duplicates are skipped there as usual).
-- Items: [{artist_id, title, album, release_date, featuring, producers, length_sec}]
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
             'status_guess', 'unconfirmed',
             'album', nullif(left(trim(coalesce(it ->> 'album', '')), 200), ''),
             'release_date', case when (it ->> 'release_date') ~ '^\d{4}-\d{2}-\d{2}$' then it ->> 'release_date' end,
             'extra', jsonb_strip_nulls(jsonb_build_object(
               'featuring', nullif(left(trim(coalesce(it ->> 'featuring', '')), 300), ''),
               'producers', nullif(left(trim(coalesce(it ->> 'producers', '')), 300), ''),
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

-- Suggestions from files always wait for review, even from trusted
-- contributors.
do $$
declare
  d text := pg_get_functiondef('public.submissions_trusted_apply()'::regprocedure);
  a text := 'or not sc_is_trusted(new.submitted_by) then';
begin
  if position(a in d) > 0 then
    execute replace(d, a, 'or not sc_is_trusted(new.submitted_by)
     or coalesce(new.payload ->> ''from'', '''') = ''local'' then');
  end if;
end $$;

-- Approving details from files: only fields that are still empty are
-- filled (anything filled in since is skipped), plus length and cover.
do $$
declare
  d text := pg_get_functiondef('public.approve_submission(uuid, text[], text)'::regprocedure);
  a text := E'update tracks set\r\n      title = case when ''title'' = any(p_excluded_fields) then title';
  b text := E'if coalesce(sub.payload ->> ''from'', '''') = ''local'' then\r\n'
    || E'      -- From someone''s files: never overwrite, only fill gaps.\r\n'
    || E'      select coalesce(p_excluded_fields, ''{}'') || array_remove(array[\r\n'
    || E'        case when t.album is not null then ''album'' end,\r\n'
    || E'        case when t.release_date is not null then ''release_date'' end,\r\n'
    || E'        case when t.track_number is not null then ''track_number'' end,\r\n'
    || E'        case when t.producers is not null then ''producers'' end,\r\n'
    || E'        case when t.featured_artists is not null then ''featured_artists'' end], null)\r\n'
    || E'      into p_excluded_fields from tracks t where t.id = new_id;\r\n'
    || E'      update tracks set\r\n'
    || E'        length_sec = case when length_sec is not null or ''length_sec'' = any(p_excluded_fields) then length_sec\r\n'
    || E'          else nullif(sub.payload ->> ''length_sec'', '''')::int end,\r\n'
    || E'        cover_url = case when cover_url is not null or ''cover_url'' = any(p_excluded_fields) then cover_url\r\n'
    || E'          else nullif(sub.payload ->> ''cover_url'', '''') end\r\n'
    || E'      where id = new_id;\r\n'
    || E'    end if;\r\n    ';
begin
  if position(a in d) > 0 and position('From someone''s files' in d) = 0 then
    execute replace(d, a, b || a);
  end if;
end $$;

-- Song pages: show the length.
do $$
declare
  d text := pg_get_functiondef('public.rpc_song_page(text)'::regprocedure);
begin
  if position('''length_sec''' in d) = 0 then
    execute replace(d, '''deezer_url'', t.deezer_url,', '''deezer_url'', t.deezer_url, ''length_sec'', t.length_sec,');
  end if;
end $$;
