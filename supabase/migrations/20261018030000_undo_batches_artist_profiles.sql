-- Safety before the big automatic jobs.
--
-- 1. Undo for bulk jobs. Any change made while a "batch" is active is
--    recorded (the row before and after) in change_log. An admin can then
--    reverse the whole batch from /admin/batches. Batches are started by:
--      - the merge functions (quick merge, duplicate merge, single merge)
--      - the Spotify matcher (one batch per 12 hours of matching)
--      - future jobs (auto sub-versions, imports) via sc_begin_batch()
--    Undoing a batch is itself recorded as a batch, so an undo can be undone.
--    Rows that someone has changed since the batch ran are left alone and
--    reported as "skipped", so an undo never overwrites newer edits.
--    Logs older than 60 days are cleared out automatically.
--
-- 2. External profiles on artists: Spotify artist ID, Genius artist ID and
--    Last.fm name, so imports pull from the right artist when names clash.

-- ---------------------------------------------------------------------------
-- 1. Batches and the change log
-- ---------------------------------------------------------------------------

create table if not exists change_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  label text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid,
  undo_batch_id uuid references change_batches(id) on delete set null,
  undo_of uuid references change_batches(id) on delete set null,
  undo_skipped int not null default 0
);
create index if not exists change_batches_created_idx on change_batches (created_at desc);
create index if not exists change_batches_kind_idx on change_batches (kind, created_at desc);

create table if not exists change_log (
  id bigint generated always as identity primary key,
  batch_id uuid not null references change_batches(id) on delete cascade,
  table_name text not null,
  op text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  old_row jsonb,
  new_row jsonb,
  undo_state text check (undo_state in ('undone', 'skipped')),
  created_at timestamptz not null default now()
);
create index if not exists change_log_batch_idx on change_log (batch_id, id desc);

alter table change_batches enable row level security;
alter table change_log enable row level security;
drop policy if exists change_batches_admin_read on change_batches;
create policy change_batches_admin_read on change_batches for select using (is_admin());
drop policy if exists change_log_admin_read on change_log;
create policy change_log_admin_read on change_log for select using (is_admin());
revoke all on change_batches, change_log from anon;
revoke insert, update, delete on change_batches, change_log from authenticated;

-- The batch the current statement belongs to, or null. Set either inside a
-- database function (sc_begin_batch) or, for server jobs using the service
-- key, with an "x-sc-batch" request header.
create or replace function sc_current_batch()
returns uuid
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v text := nullif(current_setting('static_cuts.batch_id', true), '');
  v_role text;
begin
  if v is null then
    v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
    if v_role = 'service_role' then
      v := nullif(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-sc-batch', '');
    end if;
  end if;
  if v is null or v !~ '^[0-9a-f-]{36}$' then
    return null;
  end if;
  return v::uuid;
end;
$$;

create or replace function sc_log_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_batch uuid := sc_current_batch();
begin
  if v_batch is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return null;
  end if;
  -- An unknown batch id (e.g. a stale header) shouldn't block the change.
  if not exists (select 1 from change_batches where id = v_batch) then
    return null;
  end if;
  insert into change_log (batch_id, table_name, op, old_row, new_row)
  values (
    v_batch, tg_table_name, tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'artists', 'tracks', 'track_appearances', 'track_redirects', 'track_ownership',
    'ratings', 'comments', 'comment_votes', 'track_link_candidates', 'track_status_events'
  ] loop
    execute format('drop trigger if exists zz_log_change on public.%I', t);
    execute format(
      'create trigger zz_log_change after insert or update or delete on public.%I
       for each row execute function sc_log_change()', t);
  end loop;
end $$;

-- Start a batch for the rest of this database call and return its id.
-- If one is already active in this call, return that one instead.
create or replace function sc_begin_batch(p_kind text, p_label text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing uuid := nullif(current_setting('static_cuts.batch_id', true), '')::uuid;
  v_id uuid;
  v_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  if not (is_admin() or v_role = 'service_role' or session_user = 'postgres') then
    raise exception 'not authorized';
  end if;
  if v_existing is not null and exists (select 1 from change_batches where id = v_existing) then
    return v_existing;
  end if;
  insert into change_batches (kind, label) values (p_kind, p_label) returning id into v_id;
  perform set_config('static_cuts.batch_id', v_id::text, true);
  -- Keep the log small: clear out batches older than 60 days.
  delete from change_batches where created_at < now() - interval '60 days';
  return v_id;
end;
$$;

-- For server jobs that run as many separate calls (the Spotify matcher):
-- reuse the most recent batch of this kind from the last 12 hours, or start
-- a new one. Returns the id to send as the x-sc-batch header.
create or replace function sc_job_batch(p_kind text, p_label text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  if not (is_admin() or v_role = 'service_role' or session_user = 'postgres') then
    raise exception 'not authorized';
  end if;
  select id into v_id from change_batches
  where kind = p_kind and undone_at is null and created_at > now() - interval '12 hours'
  order by created_at desc limit 1;
  if v_id is null then
    insert into change_batches (kind, label)
    values (p_kind, coalesce(p_label, p_kind) || ' ' || to_char(now() at time zone 'Europe/London', 'DD Mon HH24:MI'))
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Primary-key match for a logged row, as SQL text.
create or replace function sc_pk_match(p_table text, p_row jsonb)
returns text
language sql
stable
set search_path to 'public'
as $$
  select string_agg(format('(%I)::text = %L', a.attname, p_row ->> a.attname::text), ' and ')
  from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
  where i.indrelid = ('public.' || quote_ident(p_table))::regclass and i.indisprimary;
$$;

-- Reverse one logged change. Returns 'undone' or 'skipped' (someone changed
-- the row since). Raises on errors such as a missing parent row, so the
-- caller can retry it after other changes are reversed.
create or replace function sc_undo_change(c change_log)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_where text;
  v_cols text;
  v_current jsonb;
begin
  v_where := sc_pk_match(c.table_name, coalesce(c.new_row, c.old_row));
  execute format('select to_jsonb(t) from public.%I t where %s', c.table_name, v_where) into v_current;

  if c.op = 'INSERT' then
    if v_current is null then return 'undone'; end if;
    if v_current <> c.new_row then return 'skipped'; end if;
    execute format('delete from public.%I where %s', c.table_name, v_where);

  elsif c.op = 'UPDATE' then
    if v_current is null or v_current <> c.new_row then return 'skipped'; end if;
    select string_agg(quote_ident(attname), ', ' order by attnum) into v_cols
    from pg_attribute
    where attrelid = ('public.' || quote_ident(c.table_name))::regclass and attnum > 0 and not attisdropped;
    execute format(
      'update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where %s',
      c.table_name, v_cols, v_cols, c.table_name, sc_pk_match(c.table_name, c.new_row))
    using c.old_row;

  else -- DELETE
    if v_current is not null then
      return case when v_current = c.old_row then 'undone' else 'skipped' end;
    end if;
    execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)',
                   c.table_name, c.table_name)
    using c.old_row;
  end if;
  return 'undone';
end;
$$;

-- Undo a batch, a chunk at a time (big batches take several calls; the
-- page keeps calling until "remaining" is 0).
create or replace function admin_undo_batch(p_batch uuid, p_chunk int default 1500)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  b change_batches%rowtype;
  v_undo uuid;
  c change_log;
  v_result text;
  v_failed bigint[] := '{}';
  v_retry bigint[];
  v_done int := 0;
  v_skipped int := 0;
  v_pass int;
  v_remaining int;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  select * into b from change_batches where id = p_batch for update;
  if b.id is null then raise exception 'batch not found'; end if;
  if b.undone_at is not null then raise exception 'this batch has already been undone'; end if;

  -- The undo is recorded as its own batch (so it can be undone too).
  v_undo := b.undo_batch_id;
  if v_undo is null then
    insert into change_batches (kind, label, undo_of)
    values ('undo', 'Undo: ' || coalesce(b.label, b.kind), b.id)
    returning id into v_undo;
    update change_batches set undo_batch_id = v_undo where id = b.id;
  end if;
  perform set_config('static_cuts.batch_id', v_undo::text, true);
  -- Restoring a song's status shouldn't add a new entry to its history.
  perform set_config('static_cuts.skip_status_log', 'on', true);

  for c in
    select * from change_log
    where batch_id = p_batch and undo_state is null
    order by id desc
    limit greatest(1, least(coalesce(p_chunk, 1500), 5000))
  loop
    begin
      v_result := sc_undo_change(c);
      update change_log set undo_state = v_result where id = c.id;
      if v_result = 'undone' then v_done := v_done + 1; else v_skipped := v_skipped + 1; end if;
    exception when others then
      v_failed := v_failed || c.id;
    end;
  end loop;

  -- Changes that failed (usually a row whose parent wasn't back yet) get a
  -- couple more tries now that the rest of the chunk is reversed.
  for v_pass in 1..3 loop
    exit when cardinality(v_failed) = 0;
    v_retry := v_failed;
    v_failed := '{}';
    for c in select * from change_log where id = any (v_retry) order by id desc loop
      begin
        v_result := sc_undo_change(c);
        update change_log set undo_state = v_result where id = c.id;
        if v_result = 'undone' then v_done := v_done + 1; else v_skipped := v_skipped + 1; end if;
      exception when others then
        v_failed := v_failed || c.id;
      end;
    end loop;
  end loop;

  select count(*) into v_remaining from change_log where batch_id = p_batch and undo_state is null;
  update change_batches set undo_skipped = undo_skipped + v_skipped where id = p_batch;

  if v_remaining = 0 then
    update change_batches set undone_at = now(), undone_by = auth.uid() where id = p_batch;
  end if;

  return jsonb_build_object(
    'undone', v_done,
    'skipped', v_skipped,
    'failed', cardinality(v_failed),
    'remaining', v_remaining,
    'finished', v_remaining = 0,
    -- No progress at all means the rest can't be reversed automatically.
    'stuck', v_remaining > 0 and v_done = 0 and v_skipped = 0
  );
end;
$$;

-- Recent batches for the admin page.
create or replace function admin_list_batches(p_limit int default 100)
returns table (
  id uuid, kind text, label text, created_at timestamptz, created_by_name text,
  changes bigint, undone_at timestamptz, undo_skipped int, undo_of uuid,
  tables jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select b.id, b.kind, b.label, b.created_at, p.display_name,
         (select count(*) from change_log l where l.batch_id = b.id),
         b.undone_at, b.undo_skipped, b.undo_of,
         (select coalesce(jsonb_object_agg(x.k, x.n), '{}'::jsonb) from (
            select l.table_name || ' ' || lower(l.op) k, count(*) n
            from change_log l where l.batch_id = b.id group by 1) x)
  from change_batches b
  left join profiles p on p.id = b.created_by
  where is_admin()
  order by b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

-- A sample of what a batch changed, for the admin page.
create or replace function admin_batch_changes(p_batch uuid, p_limit int default 50)
returns table (table_name text, op text, old_row jsonb, new_row jsonb, undo_state text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select l.table_name, l.op, l.old_row, l.new_row, l.undo_state
  from change_log l
  where l.batch_id = p_batch and is_admin()
  order by l.id
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

-- ---------------------------------------------------------------------------
-- Merges now run inside a batch, so they can be undone.
-- ---------------------------------------------------------------------------

create or replace function public.admin_merge_track(p_duplicate_track_id text, p_survivor_track_id text, p_appearance_artist_id text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_duplicate_artist_id text;
  v_duplicate_title text;
  v_duplicate_aliases text;
  v_survivor_aliases text;
  v_merged_aliases text;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;

  select artist_id, title, aliases into v_duplicate_artist_id, v_duplicate_title, v_duplicate_aliases
  from tracks where id = p_duplicate_track_id;

  perform sc_begin_batch('merge', 'Merge: ' || coalesce(v_duplicate_title, p_duplicate_track_id));

  select aliases into v_survivor_aliases from tracks where id = p_survivor_track_id;

  -- Fold the duplicate's title and any aliases it had into the
  -- survivor's alias list, so text search for the old name still works.
  v_merged_aliases := trim(both ', ' from
    coalesce(v_survivor_aliases, '') ||
    case when v_survivor_aliases is not null and v_survivor_aliases <> '' then ', ' else '' end ||
    v_duplicate_title ||
    case when v_duplicate_aliases is not null and v_duplicate_aliases <> '' then ', ' || v_duplicate_aliases else '' end
  );
  update tracks set aliases = nullif(v_merged_aliases, '') where id = p_survivor_track_id;

  -- Record the redirect before deleting.
  insert into track_redirects (old_track_id, new_track_id)
  values (p_duplicate_track_id, p_survivor_track_id)
  on conflict (old_track_id) do update set new_track_id = excluded.new_track_id;

  -- Chain: anything that already redirected TO the duplicate now points
  -- straight at the final survivor instead.
  update track_redirects set new_track_id = p_survivor_track_id where new_track_id = p_duplicate_track_id;

  delete from tracks where id = p_duplicate_track_id;

  insert into admin_actions (artist_id, track_id, action_type, details)
  values (v_duplicate_artist_id, p_survivor_track_id, 'edit', jsonb_build_object('title', v_duplicate_title, 'note', 'merged into another track'));

  insert into track_appearances (track_id, artist_id) values (p_survivor_track_id, p_appearance_artist_id)
  on conflict (track_id, artist_id) do nothing;
end;
$function$;

create or replace function public.admin_merge_duplicates(p_survivor text, p_duplicates text[])
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  s tracks%rowtype;
  d tracks%rowtype;
  v_dup text;
  merged int := 0;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  select * into s from tracks where id = p_survivor;
  if s.id is null then raise exception 'track to keep not found'; end if;

  perform sc_begin_batch('merge', 'Merge duplicates of ' || s.title);

  foreach v_dup in array coalesce(p_duplicates, '{}') loop
    continue when v_dup = p_survivor;
    select * into d from tracks where id = v_dup;
    continue when d.id is null;

    -- Sub-versions follow their parent to the kept track's page; their old
    -- artist stays linked.
    insert into track_appearances (track_id, artist_id)
    select v.id, v.artist_id from tracks v
    where v.parent_track_id = v_dup and v.artist_id is distinct from s.artist_id and v.artist_id is not null
    on conflict do nothing;
    update tracks set parent_track_id = p_survivor, artist_id = s.artist_id where parent_track_id = v_dup;

    insert into track_ownership (user_id, track_id, collected_at)
    select user_id, p_survivor, collected_at from track_ownership where track_id = v_dup
    on conflict do nothing;
    insert into ratings (user_id, track_id, value, updated_at)
    select user_id, p_survivor, value, updated_at from ratings where track_id = v_dup
    on conflict do nothing;
    update comments set track_id = p_survivor where track_id = v_dup;
    update track_link_candidates set track_id = p_survivor where track_id = v_dup;
    update discoveries set matched_track_id = p_survivor where matched_track_id = v_dup;
    update discoveries set parent_track_id = p_survivor where parent_track_id = v_dup;

    insert into track_appearances (track_id, artist_id)
    select p_survivor, artist_id from track_appearances
    where track_id = v_dup and artist_id <> s.artist_id
    on conflict do nothing;

    update tracks t set
      release_status = case
        when d.release_status <> 'removed'
             and release_status_rank(d.release_status) > release_status_rank(t.release_status)
          then d.release_status else t.release_status end,
      spotify_url = coalesce(t.spotify_url, d.spotify_url),
      release_date = coalesce(t.release_date, d.release_date),
      album = coalesce(t.album, d.album),
      producers = coalesce(t.producers, d.producers),
      featured_artists = coalesce(t.featured_artists, d.featured_artists),
      genre = coalesce(t.genre, d.genre),
      track_number = coalesce(t.track_number, d.track_number),
      notes = coalesce(t.notes, d.notes)
    where t.id = p_survivor;

    perform admin_merge_track(v_dup, p_survivor, d.artist_id);

    -- admin_merge_track links the duplicate's artist; that's only wanted
    -- when the duplicate sat on a different artist's page.
    if d.artist_id = s.artist_id then
      delete from track_appearances where track_id = p_survivor and artist_id = s.artist_id;
    end if;

    merged := merged + 1;
  end loop;

  -- The kept title shouldn't also be listed as its own alias.
  update tracks set aliases = nullif(trim(both ', ' from (
    select string_agg(a, ', ')
    from (select distinct on (sc_title_key(a)) a
          from regexp_split_to_table(coalesce(aliases, ''), '\s*,\s*') a
          where a <> '' and sc_title_key(a) <> sc_title_key(title)) x
  )), '')
  where id = p_survivor;

  return merged;
end;
$function$;

create or replace function public.admin_quick_merge(p_groups jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  grp jsonb;
  v_ids text[];
  v_keep text;
  total int := 0;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  perform sc_begin_batch('quick_merge',
    'Quick merge: ' || jsonb_array_length(coalesce(p_groups, '[]'::jsonb)) || ' groups');
  for grp in select * from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) loop
    select array_agg(x) into v_ids from jsonb_array_elements_text(grp) x;
    continue when v_ids is null or array_length(v_ids, 1) < 2;
    select id into v_keep from tracks where id = any (v_ids)
    order by (spotify_url is null), release_status_rank(release_status) desc, id
    limit 1;
    continue when v_keep is null;
    total := total + admin_merge_duplicates(v_keep, array_remove(v_ids, v_keep));
  end loop;
  return total;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. External profiles on artists
-- ---------------------------------------------------------------------------

alter table artists add column if not exists spotify_artist_id text;
alter table artists add column if not exists genius_artist_id text;
alter table artists add column if not exists lastfm_name text;
alter table artists add column if not exists profiles_confirmed_at timestamptz;

create unique index if not exists artists_spotify_artist_id_key on artists (spotify_artist_id) where spotify_artist_id is not null;
create unique index if not exists artists_genius_artist_id_key on artists (genius_artist_id) where genius_artist_id is not null;

-- Accepts either IDs or profile links:
--   Spotify: https://open.spotify.com/artist/<id> (or spotify:artist:<id>)
--   Genius:  the numeric artist ID, or a genius.com/artists/<name> link
--            (the import looks up the numeric ID from the name later)
--   Last.fm: https://www.last.fm/music/<name> or the name itself
-- Pass an empty string to clear one; null leaves it unchanged.
create or replace function admin_set_artist_profiles(
  p_artist_id text,
  p_spotify text default null,
  p_genius text default null,
  p_lastfm text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_spotify text;
  v_genius text;
  v_lastfm text;
  v_other text;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if not exists (select 1 from artists where id = p_artist_id) then raise exception 'unknown artist'; end if;

  if p_spotify is not null then
    v_spotify := coalesce(
      (regexp_match(p_spotify, 'artist[/:]([A-Za-z0-9]{22})'))[1],
      (regexp_match(trim(p_spotify), '^([A-Za-z0-9]{22})$'))[1]);
    if trim(p_spotify) <> '' and v_spotify is null then
      raise exception 'That doesn''t look like a Spotify artist link';
    end if;
    select name into v_other from artists where spotify_artist_id = v_spotify and id <> p_artist_id;
    if v_other is not null then
      raise exception 'That Spotify profile is already linked to %', v_other;
    end if;
    update artists set spotify_artist_id = v_spotify where id = p_artist_id;
  end if;

  if p_genius is not null then
    v_genius := nullif(trim(p_genius), '');
    if v_genius ~* 'genius\.com/artists/' then
      v_genius := 'name:' || replace((regexp_match(v_genius, 'genius\.com/artists/([^/?#]+)', 'i'))[1], '-', ' ');
    end if;
    select name into v_other from artists where genius_artist_id = v_genius and id <> p_artist_id;
    if v_other is not null then
      raise exception 'That Genius profile is already linked to %', v_other;
    end if;
    update artists set genius_artist_id = v_genius where id = p_artist_id;
  end if;

  if p_lastfm is not null then
    v_lastfm := nullif(trim(p_lastfm), '');
    if v_lastfm ~* 'last\.fm/(\w+/)?music/' then
      v_lastfm := replace((regexp_match(v_lastfm, 'music/([^/?#]+)', 'i'))[1], '+', ' ');
    end if;
    update artists set lastfm_name = v_lastfm where id = p_artist_id;
  end if;

  update artists set profiles_confirmed_at = now() where id = p_artist_id;

  return (select jsonb_build_object('spotify_artist_id', spotify_artist_id, 'genius_artist_id', genius_artist_id,
                                    'lastfm_name', lastfm_name)
          from artists where id = p_artist_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke execute on function sc_current_batch(), sc_log_change(), sc_pk_match(text, jsonb),
  sc_undo_change(change_log) from public, anon, authenticated;
revoke execute on function sc_begin_batch(text, text), sc_job_batch(text, text),
  admin_undo_batch(uuid, int), admin_list_batches(int), admin_batch_changes(uuid, int),
  admin_set_artist_profiles(text, text, text, text) from public, anon;
grant execute on function sc_begin_batch(text, text), sc_job_batch(text, text),
  admin_undo_batch(uuid, int), admin_list_batches(int), admin_batch_changes(uuid, int),
  admin_set_artist_profiles(text, text, text, text) to authenticated, service_role;
grant execute on function sc_current_batch(), sc_log_change(), sc_pk_match(text, jsonb),
  sc_undo_change(change_log) to service_role;
