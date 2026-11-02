-- Claude (Haiku) goes through the open sub-version suggestions, ~40 at a
-- time. Clear yes: applied (one undoable batch per run). Clear no:
-- dismissed. Unsure: left open for the owner, with Claude's note.

alter table version_suggestions
  add column if not exists ai_verdict text,
  add column if not exists ai_note text,
  add column if not exists ai_checked_at timestamptz,
  add column if not exists ai_claim_at timestamptz;

create index if not exists version_suggestions_ai_todo
  on version_suggestions (track_id) where state = 'open' and ai_checked_at is null;

-- Next suggestions to check, grouped by artist and song so Claude sees a
-- song's versions together.
create or replace function sc_version_ai_next(p_secret text, p_limit int default 40)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  with pick as (
    select vs.id
    from version_suggestions vs join tracks t on t.id = vs.track_id
    left join tracks p on p.id = vs.parent_track_id
    where vs.state = 'open' and vs.ai_checked_at is null
      and (vs.ai_claim_at is null or vs.ai_claim_at < now() - interval '10 minutes')
    order by t.artist_id, sc_title_key(coalesce(p.title, vs.create_parent_title, t.title)), vs.id
    limit greatest(1, least(coalesce(p_limit, 40), 80))
    for update of vs skip locked
  ), claimed as (
    update version_suggestions vs set ai_claim_at = now() from pick where vs.id = pick.id returning vs.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', vs.id, 'artist', a.name, 'song', t.title, 'status', t.release_status,
    'action', vs.action, 'version', vs.version,
    'main_song', coalesce(p.title, vs.create_parent_title),
    'main_exists', vs.parent_track_id is not null,
    'main_artist', pa.name) order by a.name, coalesce(p.title, vs.create_parent_title), t.title), '[]'::jsonb)
  into v
  from claimed c join version_suggestions vs on vs.id = c.id
  join tracks t on t.id = vs.track_id left join artists a on a.id = t.artist_id
  left join tracks p on p.id = vs.parent_track_id left join artists pa on pa.id = p.artist_id;
  return v;
end;
$$;

-- Saves Claude's answers: [{id, verdict: yes|no|unsure, note}].
create or replace function sc_version_ai_save(p_secret text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yes uuid[]; v_no uuid[]; v_applied int := 0;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  update version_suggestions vs
  set ai_verdict = case when i->>'verdict' in ('yes', 'no') then i->>'verdict' else 'unsure' end,
      ai_note = left(nullif(i->>'note', ''), 300),
      ai_checked_at = now(), ai_claim_at = null
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  where vs.id = (i->>'id')::uuid and vs.state = 'open';
  select array_agg(vs.id) filter (where vs.ai_verdict = 'yes'), array_agg(vs.id) filter (where vs.ai_verdict = 'no')
  into v_yes, v_no
  from version_suggestions vs
  where vs.id in (select (i->>'id')::uuid from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i where i->>'id' ~ '^[0-9a-f-]{36}$')
    and vs.state = 'open';
  if v_yes is not null then
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('sub_versions', 'Sub-versions: ' || cardinality(v_yes) || ' approved by Claude');
    v_applied := coalesce(sc_apply_version_suggestions(v_yes), 0);
  end if;
  if v_no is not null then
    update version_suggestions set state = 'dismissed', decided_at = now() where id = any (v_no) and state = 'open';
  end if;
  return jsonb_build_object('yes', coalesce(cardinality(v_yes), 0), 'no', coalesce(cardinality(v_no), 0), 'applied', v_applied);
end;
$$;

revoke execute on function sc_version_ai_next(text, int), sc_version_ai_save(text, jsonb) from public, anon, authenticated;

-- Review page: Claude's note on the ones it left for you.
create or replace function admin_version_ai_notes(p_ids uuid[])
returns table (id uuid, verdict text, note text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select vs.id, vs.ai_verdict, vs.ai_note from version_suggestions vs
  where is_moderator() and vs.id = any (p_ids) and vs.ai_checked_at is not null;
$$;
revoke execute on function admin_version_ai_notes(uuid[]) from public, anon;
grant execute on function admin_version_ai_notes(uuid[]) to authenticated;

-- Timer: every 2 minutes (even minutes).
select cron.schedule('version-ai', '*/2 * * * *', $cmd$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := jsonb_build_object('fn', 'version-ai', 'body', '{}'::jsonb),
    timeout_milliseconds := 15000);
$cmd$);
