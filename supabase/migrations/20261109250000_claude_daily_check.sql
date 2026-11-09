-- Daily check by Claude (9 Nov 2026).
--
-- A scheduled Claude task works through ~50 songs of the catalogue backlog a
-- day with web search. It reaches the database through sc_claude_call (not
-- callable from the site or the API: database owner only), which acts as the
-- owner's account so finds are credited and deduplicated like the ChatGPT
-- connector's -- but with static_cuts.review_only on, so nothing it sends is
-- applied automatically: every find, link, detail and show waits for review.

-- Review-only switch: no trusted / auto approval while it's on.
do $$
declare d text;
begin
  d := pg_get_functiondef('sc_try_auto_approve(uuid)'::regprocedure);
  d := regexp_replace(d, 'begin\s*v_reason := sc_auto_approve_reason\(p_discovery\);',
    'begin
  if current_setting(''static_cuts.review_only'', true) = ''on'' then return null; end if;
  v_reason := sc_auto_approve_reason(p_discovery);');
  if position('static_cuts.review_only' in d) = 0 then raise exception 'auto approve patch failed'; end if;
  execute d;

  d := pg_get_functiondef('submissions_trusted_apply()'::regprocedure);
  d := replace(d, $q$or jsonb_typeof(new.payload -> 'previous') = 'object' then$q$,
                  $q$or jsonb_typeof(new.payload -> 'previous') = 'object'
     or current_setting('static_cuts.review_only', true) = 'on' then$q$);
  if position('static_cuts.review_only' in d) = 0 then raise exception 'trusted apply patch failed'; end if;
  execute d;

  d := pg_get_functiondef('rpc_submit_announcement(jsonb)'::regprocedure);
  d := replace(d, $q$v_state := case when is_owner() or is_moderator() or sc_is_trusted(uid) then 'approved' else 'open' end;$q$,
                  $q$v_state := case when current_setting('static_cuts.review_only', true) = 'on' then 'open'
                       when is_owner() or is_moderator() or sc_is_trusted(uid) then 'approved' else 'open' end;$q$);
  if position('static_cuts.review_only' in d) = 0 then raise exception 'announcement patch failed'; end if;
  execute d;
end $$;

create or replace function sc_claude_call(p_tool text, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := (select id from auth.users where email = 'dg.theswingingman@gmail.com');
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'email', 'dg.theswingingman@gmail.com', 'role', 'authenticated')::text, true);
  perform set_config('static_cuts.review_only', 'on', true);
  return case p_tool
    when 'backlog' then rpc_catalogue_backlog(p ->> 'artist_id', p ->> 'kind',
                          coalesce((p ->> 'limit')::int, 50), coalesce((p ->> 'offset')::int, 0))
    when 'artist_songs' then rpc_artist_songs(p ->> 'artist_id', coalesce((p ->> 'limit')::int, 100), coalesce((p ->> 'offset')::int, 0))
    when 'check' then rpc_check_candidates(p)
    when 'discovery' then rpc_submit_discovery(p || jsonb_build_object('notes', left('[Claude daily check] ' || coalesce(p ->> 'notes', ''), 2000)))
    when 'link' then rpc_suggest_link(p)
    when 'details' then rpc_suggest_details(p)
    when 'announcement' then rpc_submit_announcement(p)
    when 'mark_checked' then rpc_mark_checked(p)
    when 'finish' then rpc_finish_run(p)
    else jsonb_build_object('error', 'unknown tool: backlog, artist_songs, check, discovery, link, details, announcement, mark_checked, finish')
  end;
end $function$;
revoke execute on function sc_claude_call(text, jsonb) from public, anon, authenticated, service_role;
