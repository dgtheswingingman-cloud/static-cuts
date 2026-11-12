-- 1. The 60-an-hour limits on suggestions and links skip moderators, but
--    checked the sign-in's email, which a ChatGPT connector sign-in doesn't
--    carry: the owner's own routine was limited. Check the account instead.
-- 2. The "background job calls failed" alert counted the SoundCloud cover
--    job's dead links (404s are answers there, not failures).
do $$
declare d text; o text;
begin
  o := pg_get_functiondef('submissions_anti_spam()'::regprocedure);
  d := replace(o, $x$if v_uid is null or is_moderator() or coalesce$x$, $x$if v_uid is null or is_moderator() or sc_user_can_moderate(v_uid) or coalesce$x$);
  if d <> o then execute d; end if;

  o := pg_get_functiondef('link_candidates_anti_spam()'::regprocedure);
  d := replace(o, $x$if v_uid is null or is_moderator() then return new; end if;$x$, $x$if v_uid is null or is_moderator() or sc_user_can_moderate(v_uid) then return new; end if;$x$);
  if d <> o then execute d; end if;

  o := pg_get_functiondef('sc_background_check()'::regprocedure);
  d := replace(o, $x$    where created > now() - interval '1 hour' and (timed_out or status_code >= 400 or error_msg is not null)$x$,
                  $x$    where created > now() - interval '1 hour' and (timed_out or status_code >= 400 or error_msg is not null)
      and not exists (select 1 from soundcloud_cover_checks s where s.request_id = net._http_response.id)$x$);
  if d <> o and position('soundcloud_cover_checks s' in o) = 0 then execute d; end if;
end $$;
