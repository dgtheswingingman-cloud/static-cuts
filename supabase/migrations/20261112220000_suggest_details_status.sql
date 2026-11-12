-- suggest_details can change a song's status too (leaked -> released when it
-- came out officially, released -> leaked when it was really a leak, etc.):
-- it files a status change (carrying the release date when it's now
-- released) next to any details. A release date for a song that stays a
-- leak / snippet / rumour is refused with a note; a leak date is always fine
-- (for released songs it's their history). Applied live 12 Nov as
-- "suggest_details_status" (patch of rpc_suggest_details on top of
-- 20261112210000_dates_by_status.sql).
do $$
declare d text; o text;
begin
  o := pg_get_functiondef('rpc_suggest_details(jsonb)'::regprocedure);
  if position('v_status_sent boolean' in o) > 0 then return; end if; -- already applied
  d := replace(o, E'  x text;\nbegin', E'  x text;\n  v_to text;\n  v_status_sent boolean := false;\nbegin');
  d := replace(d, $x$  if (p ->> 'release_date') ~ '^\d{4}-\d{2}-\d{2}$' and t.release_status in ('leaked', 'snippet', 'rumored', 'teased') then
    raise exception '"%" is %, not released, so it has no release date (that is only for songs that came out officially). For a leak or snippet send leak_date, the day the file surfaced. If it really did come out officially, send that with submit_discovery first.', t.title, t.release_status;
  end if;$x$, $x$  -- A status change (e.g. leaked -> released, released -> leaked).
  v_to := lower(nullif(trim(coalesce(p ->> 'status', '')), ''));
  if v_to is not null and v_to not in ('released', 'leaked', 'snippet', 'teased', 'announced', 'rumored', 'removed') then
    raise exception 'status must be one of released, leaked, snippet, teased, announced, rumored, removed';
  end if;
  if v_to = coalesce(t.release_status, 'unconfirmed') then v_to := null; end if;
  if v_to is not null then
    if coalesce(p ->> 'source_url', '') !~* '^https?://' then raise exception 'a status change needs source_url: the page that shows it'; end if;
    if not exists (select 1 from submissions s where s.type = 'status_change' and s.status = 'pending' and s.payload ->> 'track_id' = t.id) then
      insert into submissions (type, artist_id, payload, submitted_by)
      values ('status_change', t.artist_id, jsonb_strip_nulls(jsonb_build_object(
        'track_id', t.id, 'from_status', coalesce(t.release_status, 'unconfirmed'), 'to_status', v_to,
        'release_date', case when v_to in ('released', 'announced') and (p ->> 'release_date') ~ '^\d{4}-\d{2}-\d{2}$' then p ->> 'release_date' end,
        'from', 'routine',
        'notes', left(coalesce(nullif(p ->> 'notes', ''), 'Status change from the ChatGPT routine.') || E'\nSource: ' || (p ->> 'source_url'), 2000))),
        auth.uid());
      v_status_sent := true;
    end if;
    if v_to in ('released', 'announced') then p := p - 'release_date'; end if;
  end if;
  if (p ->> 'release_date') ~ '^\d{4}-\d{2}-\d{2}$' and coalesce(v_to, t.release_status) in ('leaked', 'snippet', 'rumored', 'teased') then
    raise exception '"%" is %, so it has no release date: that is only for songs that came out officially. Send leak_date (the day the file or snippet surfaced) instead. If it did come out officially, send status = released with the release_date.', t.title, coalesce(v_to, t.release_status);
  end if;$x$);
  d := replace(d, $x$  if v = '{}'::jsonb then
    return jsonb_build_object('ok', true, 'sent', false, 'note',$x$, $x$  if v = '{}'::jsonb and v_status_sent then
    return jsonb_build_object('ok', true, 'sent', true, 'status_change', v_to);
  end if;
  if v = '{}'::jsonb then
    return jsonb_build_object('ok', true, 'sent', false, 'note',$x$);
  d := replace(d, $x$  return jsonb_build_object('ok', true, 'sent', true, 'correction', v_replace, 'fields', (select jsonb_agg(k) from jsonb_object_keys(v) k));$x$,
                  $x$  return jsonb_build_object('ok', true, 'sent', true, 'correction', v_replace, 'status_change', case when v_status_sent then v_to end, 'fields', (select jsonb_agg(k) from jsonb_object_keys(v) k));$x$);
  if position('v_status_sent boolean' in d) = 0 then raise exception 'patch did not apply'; end if;
  execute d;
end $$;
