-- Dismissed finds get a second look after 90 days (9 Nov 2026).
--
-- Before: a find dismissed once stayed dismissed forever; sending it again
-- only bumped last_seen_at. Now:
--   - get_catalogue_backlog lists dismissed finds (90+ days old, not looked at
--     again since) under recheck, for the connector to look for new evidence
--   - submitting one again after 90 days reopens it for review, with a note
--   - mark_checked takes discovery_ids so a recheck with nothing new isn't
--     offered again for another 90 days
alter table discoveries add column if not exists rechecked_at timestamptz;

do $$
declare d text := pg_get_functiondef('rpc_submit_discovery(jsonb)'::regprocedure);
begin
  -- (the function body has Windows line endings, hence the regex)
  d := regexp_replace(d, 'on conflict \(fingerprint\) do update set\s*last_seen_at = now\(\),', $q$on conflict (fingerprint) do update set
    last_seen_at = now(),
    -- Dismissed 90+ days ago and sent again: back to review.
    state = case when discoveries.state in ('dismissed', 'stale')
                  and coalesce(discoveries.reviewed_at, discoveries.last_seen_at) < now() - interval '90 days'
                 then 'open' else discoveries.state end,
    review_note = case when discoveries.state in ('dismissed', 'stale')
                        and coalesce(discoveries.reviewed_at, discoveries.last_seen_at) < now() - interval '90 days'
                       then left('Sent again after being dismissed on ' || to_char(coalesce(discoveries.reviewed_at, discoveries.last_seen_at), 'DD Mon YYYY')
                                 || coalesce(' (' || discoveries.review_note || ')', ''), 1000)
                       else discoveries.review_note end,$q$);
  if position('Sent again after being dismissed' in d) = 0 then raise exception 'submit patch failed'; end if;
  execute d;
end $$;

create or replace function rpc_mark_checked(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare n int; m int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update tracks set routine_checked_at = now()
  where id in (select x from jsonb_array_elements_text(coalesce(p -> 'track_ids', '[]'::jsonb)) x limit 100);
  get diagnostics n = row_count;
  update discoveries set rechecked_at = now()
  where state in ('dismissed', 'stale')
    and id::text in (select x from jsonb_array_elements_text(coalesce(p -> 'discovery_ids', '[]'::jsonb)) x limit 100);
  get diagnostics m = row_count;
  return jsonb_build_object('ok', true, 'marked', n, 'rechecked', m);
end $function$;

-- Backlog: add the dismissed finds due a second look.
do $$
declare d text := pg_get_functiondef('rpc_catalogue_backlog(text, text, integer, integer)'::regprocedure);
begin
  d := replace(d, $q$    'songs', v_items,$q$, $q$    'songs', v_items,
    'recheck', coalesce((select jsonb_agg(jsonb_build_object(
        'discovery_id', d.id, 'artist_id', coalesce(d.main_artist_id, d.artist_id), 'title', d.title, 'version', d.version_hint,
        'status', d.to_status, 'type', d.development_type, 'dismissed_on', coalesce(d.reviewed_at, d.last_seen_at)::date,
        'reviewer_note', d.review_note))
      from (select * from discoveries d
            where d.state in ('dismissed', 'stale')
              and (d.artist_id = any (v_artists) or d.main_artist_id = any (v_artists))
              and coalesce(d.reviewed_at, d.last_seen_at) < now() - interval '90 days'
              and (d.rechecked_at is null or d.rechecked_at < now() - interval '90 days')
            order by coalesce(d.reviewed_at, d.last_seen_at) limit 10) d), '[]'::jsonb),$q$);
  d := replace(d, $q$every follow is up to date for now (checked_recently says how many come back after 30 days).');$q$,
    $q$every follow is up to date for now (checked_recently says how many come back after 30 days). recheck lists finds '
      || 'the reviewer dismissed 90+ days ago: look for NEW evidence (an upload, an official post, a credible tracker '
      || 'entry). If you find some, submit_discovery it again with the new source_url (it goes back to review). '
      || 'Either way, call mark_checked with their discovery_ids.');$q$);
  if position('discovery_id'', d.id' in d) = 0 or position('discovery_ids' in d) = 0 then raise exception 'backlog patch failed'; end if;
  execute d;
end $$;
