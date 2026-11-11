-- Daily check, moved into the site (11 Nov 2026). It was a scheduled Claude
-- session on the owner's account; now it's a background job using the site's
-- own Claude key (like the spreadsheet checker), and what it finds is
-- credited to no one and always waits for review:
--   status   -> a status change suggestion (Suggestions list)
--   link     -> a link candidate (like other link finds)
--   details  -> a suggested edit (Suggestions list)
-- A few songs an hour (claude_check_per_run, default 2), from the backlog
-- of artists people follow, most-followed first; never-checked songs first.

create or replace function sc_claude_check_next(p_secret text, p_limit int default 2)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_secret is distinct from (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  return (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select t.id track_id, t.title, a.name artist, t.artist_id, coalesce(t.release_status, 'unconfirmed') status,
           t.album, t.release_date, t.producers, sc_track_needs(t) needs,
           (select p.title from tracks p where p.id = t.parent_track_id) version_of
    from (select f.artist_id, count(*) n from follows f group by 1) fa
    join tracks t on t.artist_id = fa.artist_id
    join artists a on a.id = t.artist_id
    where cardinality(sc_track_needs(t)) > 0
      and (t.routine_checked_at is null or t.routine_checked_at < now() - interval '30 days')
    order by t.routine_checked_at nulls first, fa.n desc, (t.parent_track_id is not null), t.id
    limit greatest(1, least(coalesce(p_limit, 2), 10))) x);
end $function$;
revoke execute on function sc_claude_check_next(text, int) from public, anon, authenticated;

-- p: {status, status_source, link, link_kind, link_source, album, release_date, producers, details_source, notes}
create or replace function sc_claude_check_save(p_secret text, p_track text, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare t tracks%rowtype; v jsonb := '{}'::jsonb; v_date date; v_status text; sent text[] := '{}';
begin
  if p_secret is distinct from (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  select * into t from tracks where id = p_track;
  if t.id is null then return jsonb_build_object('ok', false); end if;
  update tracks set routine_checked_at = now() where id = t.id;

  -- Status (only for songs whose status is unknown), with a source.
  v_status := lower(nullif(p ->> 'status', ''));
  if v_status in ('released', 'leaked', 'snippet', 'teased', 'announced', 'rumored', 'removed')
     and coalesce(t.release_status, 'unconfirmed') = 'unconfirmed' and t.parent_track_id is null
     and coalesce(p ->> 'status_source', '') ~* '^https?://'
     and not exists (select 1 from submissions s where s.type = 'status_change' and s.status = 'pending' and s.payload ->> 'track_id' = t.id) then
    insert into submissions (type, artist_id, payload, submitted_by)
    values ('status_change', t.artist_id, jsonb_build_object('track_id', t.id, 'from_status', coalesce(t.release_status, 'unconfirmed'),
      'to_status', v_status, 'from', 'claude-check',
      'notes', left('Found by the daily check (Claude). ' || coalesce(p ->> 'notes', '') || E'\nSources:\n' || (p ->> 'status_source'), 2000)), null);
    sent := array_append(sent, 'status');
  end if;

  -- Listen link.
  if coalesce(p ->> 'link', '') ~* '^https?://' and t.spotify_url is null
     and not exists (select 1 from track_link_candidates c where c.track_id = t.id and c.url = p ->> 'link') then
    insert into track_link_candidates (track_id, artist_id, url, title, source_domain, source, link_kind, suggested_status, confidence, notes)
    values (t.id, t.artist_id, left(p ->> 'link', 1000), t.title, substring(p ->> 'link' from '^https?://(?:www\.)?([^/]+)'), 'claude',
            coalesce(nullif(p ->> 'link_kind', ''), 'other'),
            case when v_status in ('released', 'leaked', 'snippet', 'teased', 'announced', 'rumored', 'removed') then v_status end, 0.6,
            left('Daily check (Claude). ' || coalesce(p ->> 'link_source', ''), 1000));
    sent := array_append(sent, 'link');
  end if;

  -- Missing details, from a page that shows them.
  if coalesce(p ->> 'details_source', '') ~* '^https?://' then
    if t.album is null and nullif(trim(p ->> 'album'), '') is not null then v := v || jsonb_build_object('album', left(trim(p ->> 'album'), 200)); end if;
    if t.producers is null and nullif(trim(p ->> 'producers'), '') is not null then v := v || jsonb_build_object('producers', left(trim(p ->> 'producers'), 300)); end if;
    if t.release_date is null and (p ->> 'release_date') ~ '^\d{4}-\d{2}-\d{2}$' then
      begin v_date := (p ->> 'release_date')::date; v := v || jsonb_build_object('release_date', v_date::text); exception when others then null; end;
    end if;
    if v <> '{}'::jsonb and not exists (select 1 from submissions s where s.type = 'correction' and s.status = 'pending' and s.payload ->> 'track_id' = t.id) then
      insert into submissions (type, artist_id, payload, submitted_by)
      values ('correction', t.artist_id, v || jsonb_build_object('track_id', t.id, 'from', 'claude-check', 'source_url', p ->> 'details_source',
              'reviewer_note', 'Daily check (Claude).'), null);
      sent := array_append(sent, 'details');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'sent', to_jsonb(sent));
end $function$;
revoke execute on function sc_claude_check_save(text, text, jsonb) from public, anon, authenticated;

select cron.schedule('claude-check', '37 * * * *', $$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := jsonb_build_object('fn', 'claude-check', 'body', '{}'::jsonb),
    timeout_milliseconds := 15000);
$$);

-- The old way in for the scheduled Claude session (now switched off).
drop function if exists sc_claude_call(text, jsonb);
