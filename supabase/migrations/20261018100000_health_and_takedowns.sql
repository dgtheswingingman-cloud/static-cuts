-- Running the site: takedown requests and an admin health page.
--
-- Takedowns: anyone (signed in or not) can ask for a song or page to be
-- taken down at /takedown. Requests land in /review/takedowns. "Remove"
-- marks the song removed and deletes its unofficial (suggested) links, as
-- one undoable batch; "reject" closes the request with a note. Limited to 5
-- requests a day per email address.
--
-- Health: admin_health() gathers everything worth a glance in one call:
-- catalogue numbers, review queues, the artist queue, recent ChatGPT runs,
-- imports and their errors, Spotify matching progress and recent batches.

create table if not exists takedown_requests (
  id uuid primary key default gen_random_uuid(),
  track_id text references tracks(id) on delete set null,
  artist_id text references artists(id) on delete set null,
  page_url text,
  name text not null,
  email text not null,
  relationship text not null check (relationship in ('rights_holder', 'representative', 'artist', 'other')),
  reason text not null,
  submitted_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  state text not null default 'open' check (state in ('open', 'removed', 'rejected')),
  handled_at timestamptz,
  handled_note text
);
create index if not exists takedown_requests_state_idx on takedown_requests (state, created_at desc);
alter table takedown_requests enable row level security;
drop policy if exists takedown_requests_admin_read on takedown_requests;
create policy takedown_requests_admin_read on takedown_requests for select using (is_admin());
revoke all on takedown_requests from anon;
revoke insert, update, delete on takedown_requests from authenticated;

-- Submit a request. p_page_url can be an artist or song link from the site;
-- the song/artist is picked out of it when possible.
create or replace function rpc_request_takedown(
  p_page_url text, p_name text, p_email text, p_relationship text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_artist text;
  v_track text;
  v_id uuid;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Please give your name.'; end if;
  if coalesce(trim(p_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please give a valid email address.'; end if;
  if coalesce(trim(p_reason), '') = '' or length(trim(p_reason)) < 10 then
    raise exception 'Please say what should be removed and why.';
  end if;
  if p_relationship not in ('rights_holder', 'representative', 'artist', 'other') then
    raise exception 'Please say how you''re connected to the music.';
  end if;
  if (select count(*) from takedown_requests where lower(email) = lower(trim(p_email))
      and created_at > now() - interval '1 day') >= 5 then
    raise exception 'You''ve sent several requests today. We''ll get to them; please wait before sending more.';
  end if;

  -- static-cuts.com/artist/<id>?highlight=<track id>
  v_artist := (regexp_match(coalesce(p_page_url, ''), '/artist/([^/?#]+)'))[1];
  v_track := (regexp_match(coalesce(p_page_url, ''), '[?&]highlight=([^&#]+)'))[1];
  if v_artist is not null and not exists (select 1 from artists where id = v_artist) then v_artist := null; end if;
  if v_track is not null and not exists (select 1 from tracks where id = v_track) then v_track := null; end if;

  insert into takedown_requests (track_id, artist_id, page_url, name, email, relationship, reason)
  values (v_track, v_artist, left(nullif(trim(p_page_url), ''), 1000), left(trim(p_name), 200),
          left(trim(p_email), 320), p_relationship, left(trim(p_reason), 5000))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke execute on function rpc_request_takedown(text, text, text, text, text) from public;
grant execute on function rpc_request_takedown(text, text, text, text, text) to anon, authenticated;

create or replace function admin_takedown_requests(p_state text default 'open')
returns table (
  id uuid, created_at timestamptz, state text, name text, email text, relationship text, reason text,
  page_url text, track_id text, track_title text, track_status text, artist_id text, artist_name text,
  handled_at timestamptz, handled_note text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select r.id, r.created_at, r.state, r.name, r.email, r.relationship, r.reason, r.page_url,
         r.track_id, t.title, t.release_status, coalesce(r.artist_id, t.artist_id), a.name,
         r.handled_at, r.handled_note
  from takedown_requests r
  left join tracks t on t.id = r.track_id
  left join artists a on a.id = coalesce(r.artist_id, t.artist_id)
  where is_admin() and (p_state is null or r.state = p_state)
  order by r.created_at desc
  limit 200;
$$;

-- Handle a request. p_action 'remove' needs a song: p_track_id, or the one
-- named in the request. Marks it removed and drops its suggested links.
create or replace function admin_handle_takedown(p_id uuid, p_action text, p_track_id text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r takedown_requests%rowtype;
  v_track text;
  v_links int := 0;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  select * into r from takedown_requests where id = p_id;
  if r.id is null then raise exception 'request not found'; end if;

  if p_action = 'remove' then
    v_track := coalesce(nullif(p_track_id, ''), r.track_id);
    if v_track is null or not exists (select 1 from tracks where id = v_track) then
      raise exception 'Pick the song to remove first.';
    end if;
    perform sc_begin_batch('takedown', 'Takedown: ' || (select title from tracks where id = v_track));
    update tracks set release_status = 'removed' where id = v_track;
    delete from track_link_candidates where track_id = v_track;
    get diagnostics v_links = row_count;
    update takedown_requests set state = 'removed', track_id = v_track, handled_at = now(),
      handled_note = left(p_note, 2000) where id = p_id;
  elsif p_action = 'reject' then
    update takedown_requests set state = 'rejected', handled_at = now(), handled_note = left(p_note, 2000)
    where id = p_id;
  else
    raise exception 'unknown action';
  end if;
  return jsonb_build_object('ok', true, 'links_removed', v_links);
end;
$$;

revoke execute on function admin_takedown_requests(text), admin_handle_takedown(uuid, text, text, text) from public, anon;
grant execute on function admin_takedown_requests(text), admin_handle_takedown(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Health page
-- ---------------------------------------------------------------------------

create or replace function admin_health()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  result jsonb;
begin
  if not is_admin() then raise exception 'not authorized'; end if;

  select jsonb_build_object(
    'generated_at', now(),
    'catalogue', jsonb_build_object(
      'artists', (select count(*) from artists),
      'songs', (select count(*) from tracks where parent_track_id is null),
      'versions', (select count(*) from tracks where parent_track_id is not null),
      'released', (select count(*) from tracks where release_status = 'released'),
      'leaked', (select count(*) from tracks where release_status = 'leaked'),
      'unconfirmed', (select count(*) from tracks where release_status = 'unconfirmed'),
      'with_link', (select count(*) from tracks where spotify_url is not null),
      'added_last_7_days', (select count(*) from tracks where created_at > now() - interval '7 days')
    ),
    'reviews', jsonb_build_object(
      'submissions', (select count(*) from submissions where status = 'pending'),
      'discoveries', (select count(*) from discoveries where state = 'open'),
      'sub_versions', (select count(*) from version_suggestions where state = 'open'),
      'imported_songs', (select count(*) from import_suggestions where state = 'open'),
      'takedowns', (select count(*) from takedown_requests where state = 'open'),
      'oldest_takedown', (select min(created_at) from takedown_requests where state = 'open')
    ),
    'spotify_matching', jsonb_build_object(
      'checked', (select count(*) from tracks where spotify_search_attempted_at is not null),
      'left', (select count(*) from tracks where spotify_url is null and spotify_search_attempted_at is null),
      'last_checked_at', (select max(spotify_search_attempted_at) from tracks),
      'checked_last_hour', (select count(*) from tracks where spotify_search_attempted_at > now() - interval '1 hour')
    ),
    'queue', jsonb_build_object(
      'due', (select count(*) from sc_artist_queue(500, true)),
      'next', (select coalesce(jsonb_agg(jsonb_build_object('artist_id', q.artist_id, 'name', q.name, 'why', q.reasons)), '[]'::jsonb)
               from sc_artist_queue(5, true) q)
    ),
    'routine_runs', (
      select coalesce(jsonb_agg(x order by x->>'started_at' desc), '[]'::jsonb) from (
        select jsonb_build_object('started_at', r.started_at, 'who', coalesce(p.display_name, 'someone'),
          'artists', r.artists_checked, 'findings', r.findings, 'submitted', r.submitted, 'summary', r.summary) x
        from routine_runs r left join profiles p on p.id = r.user_id
        where coalesce(r.summary, '') <> 'test_connection'
        order by r.started_at desc limit 10) s),
    'routine_users_last_7_days', (select count(distinct user_id) from routine_runs where started_at > now() - interval '7 days'),
    'imports', (
      select coalesce(jsonb_agg(x order by x->>'started_at' desc), '[]'::jsonb) from (
        select jsonb_build_object('started_at', i.started_at, 'artist', a.name, 'artist_id', i.artist_id,
          'source', i.source, 'who', coalesce(p.display_name, 'someone'), 'added', i.added, 'updated', i.updated,
          'suggested', i.suggested, 'skipped', i.skipped, 'error', i.error,
          'running', i.finished_at is null) x
        from import_runs i join artists a on a.id = i.artist_id left join profiles p on p.id = i.requested_by
        order by i.started_at desc limit 15) s),
    'problems', (
      select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) from (
        select jsonb_build_object('at', i.started_at, 'what', initcap(i.source) || ' import for ' || a.name,
          'error', i.error,
          'rate_limited', i.error ilike '%slow down%') x
        from import_runs i join artists a on a.id = i.artist_id
        where i.error is not null and i.started_at > now() - interval '7 days'
        union all
        select jsonb_build_object('at', i.started_at, 'what', initcap(i.source) || ' import for ' || a.name,
          'error', 'Still running after 10 minutes; it probably timed out.', 'rate_limited', false)
        from import_runs i join artists a on a.id = i.artist_id
        where i.finished_at is null and i.started_at < now() - interval '10 minutes'
          and i.started_at > now() - interval '7 days'
      ) s),
    'batches', (
      select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
        select jsonb_build_object('created_at', b.created_at, 'label', coalesce(b.label, b.kind), 'kind', b.kind,
          'undone', b.undone_at is not null,
          'changes', (select count(*) from change_log l where l.batch_id = b.id)) x
        from change_batches b order by b.created_at desc limit 8) s)
  ) into result;
  return result;
end;
$$;
revoke execute on function admin_health() from public, anon;
grant execute on function admin_health() to authenticated;
