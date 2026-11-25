-- Nathan, 25 Nov ("Do it all"):
-- 1. Claude's background budget (NIX checking) was a flat 1.5 days' share a
--    day, so it stopped at about $0.52 even with the month mostly unspent.
--    Now a day may also use what's left of the background share (60% of the
--    cap) spread over the days left in the month, whichever is more. The
--    month cap and the 60% background share are unchanged.
-- 2. NIX works on the main (launch) artists first in every job that has a
--    work list (notes, titles, eras, version audit, status).
-- 3. Help Wanted: the main artists come first in every list, unknown-status
--    and cover lists include them even without followers, and a new
--    "Leak dates" list: leaks and snippets missing a leak date or an era,
--    filled in on the row (admins save straight away, everyone else sends a
--    correction a moderator checks).

create or replace function public.sc_ai_can_spend(p_who text)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  cap numeric := sc_ai_month_cap();
  month numeric := sc_ai_month_usd();
  today numeric := coalesce((select sum(usd) from ai_spend where day = (now() at time zone 'utc')::date), 0);
  days int := extract(day from (date_trunc('month', now()) + interval '1 month - 1 day'))::int;
  days_left int := days - extract(day from (now() at time zone 'utc'))::int + 1;
  share numeric := cap / days;
begin
  if p_who = 'background' then
    return month < cap * 0.6
       and today < greatest(share * 1.5, (cap * 0.6 - (month - today)) / greatest(days_left, 1));
  end if;
  return month < cap and today < share * 3;
end $function$;

create or replace function public.sc_nix_focus_launch() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update nix_work w set priority = coalesce(w.priority, 0) + 1000000000000000
  where coalesce(w.priority, 0) < 1000000000000000
    and (
      (w.kind in ('notes', 'titles', 'status') and exists (select 1 from tracks t join launch_artists l on l.artist_id = t.artist_id where t.id = w.item_key))
      or (w.kind = 'eras' and exists (select 1 from launch_artists l where l.artist_id = w.group_key))
      or (w.kind = 'audit' and exists (select 1 from version_suggestions vs join tracks t on t.id = vs.track_id join launch_artists l on l.artist_id = t.artist_id
                                       where vs.id::text = w.item_key)));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.sc_nix_focus_launch() from public, anon, authenticated;

do $$
declare d text := pg_get_functiondef('public.sc_nix_work_seed()'::regprocedure);
begin
  d := replace(d, $p$  update nix_work set pending_at = null where pending_at < now() - interval '1 day';$p$,
                  $p$  perform sc_nix_focus_launch();
  update nix_work set pending_at = null where pending_at < now() - interval '1 day';$p$);
  if position('sc_nix_focus_launch' in d) = 0 then raise exception 'patch missed: seed'; end if;
  execute d;
end $$;
select public.sc_nix_focus_launch();

-- Admin fill for the new list: only fills what's empty.
create or replace function public.admin_help_leak(p_track_id text, p_leak_date date default null, p_album text default null)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_album text := nullif(trim(coalesce(p_album, '')), '');
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_leak_date is null and v_album is null then raise exception 'Nothing to fill in.'; end if;
  if p_leak_date is not null and (p_leak_date < date '1990-01-01' or p_leak_date > current_date) then
    raise exception 'That date looks wrong.';
  end if;
  if not exists (select 1 from tracks where id = p_track_id) then raise exception 'That song is gone.'; end if;
  if not exists (select 1 from tracks where id = p_track_id
                 and ((leak_date is null and p_leak_date is not null) or (album is null and v_album is not null))) then
    return;
  end if;
  if is_admin() then
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('help', 'Filled in from Help Wanted');
  end if;
  update tracks set leak_date = coalesce(leak_date, p_leak_date), album = coalesce(album, v_album) where id = p_track_id;
end $$;
revoke execute on function public.admin_help_leak(text, date, text) from public, anon;
grant execute on function public.admin_help_leak(text, date, text) to authenticated;

CREATE OR REPLACE FUNCTION public.rpc_help_wanted(p_kind text DEFAULT 'links'::text, p_following boolean DEFAULT false, p_offset integer DEFAULT 0, p_artist text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (select auth.uid() as id),
  pop as (
    select a.id, a.name,
           (select count(*) from follows f where f.artist_id = a.id) followers,
           (select count(*) from artist_requests r where r.artist_id = a.id and r.created_at > now() - interval '30 days') requests,
           exists (select 1 from launch_artists l where l.artist_id = a.id) launch
    from artists a, me
    where (p_artist is null or a.id = p_artist)
      and (p_artist is not null or not p_following or exists (select 1 from follows f where f.user_id = me.id and f.artist_id = a.id))
  ),
  cand as (
    select c.id, c.track_id, c.url, c.title as link_title, c.source_domain, c.link_kind, c.suggested_status,
           t.title, t.artist_id, coalesce((select sum(v.vote) from track_link_candidate_votes v where v.candidate_id = c.id), 0) score,
           (select count(*) from track_link_candidate_votes v where v.candidate_id = c.id) votes
    from track_link_candidates c join tracks t on t.id = c.track_id, me
    where t.spotify_url is null
      -- Only places you can actually listen (not lyrics sites, socials, news).
      and c.source_domain ~* '(^|\.)(soundcloud\.com|youtube\.com|youtu\.be|bandcamp\.com|spotify\.com|music\.apple\.com|deezer\.com|tidal\.com|audiomack\.com)$'
      and not exists (select 1 from track_link_candidate_votes v where v.candidate_id = c.id and v.user_id = me.id)
      and (p_artist is null or t.artist_id = p_artist)
  ),
  links as (
    select c.*, p.name artist, p.followers, p.requests, p.launch from cand c join pop p on p.id = c.artist_id
    where c.score > -3
  ),
  info as (
    select t.id, t.title, t.artist_id, p.name artist, p.followers, p.requests, p.launch,
           array_remove(array[case when t.release_date is null then 'release date' end,
                               case when t.album is null then 'album' end], null) missing
    from tracks t join pop p on p.id = t.artist_id
    where t.release_status = 'released' and (t.release_date is null or t.album is null)
  ),
  status as (
    select t.id, t.title, t.artist_id, p.name artist, p.followers, p.requests, p.launch
    from tracks t join pop p on p.id = t.artist_id
    where coalesce(t.release_status, 'unconfirmed') = 'unconfirmed' and t.parent_track_id is null
      and (p_artist is not null or p.launch or p.followers + p.requests > 0)
  ),
  leaks as (
    select t.id, t.title, t.artist_id, p.name artist, p.followers, p.requests, p.launch, t.release_status status,
           array_remove(array[case when t.leak_date is null and t.release_status = 'leaked' then 'leak date' end,
                               case when t.album is null then 'era' end], null) missing
    from tracks t join pop p on p.id = t.artist_id
    where t.parent_track_id is null and t.release_status in ('leaked', 'snippet')
      and ((t.leak_date is null and t.release_status = 'leaked') or t.album is null)
      and (p_artist is not null or p.launch or p.followers + p.requests > 0)
  ),
  covers as (
    select t.id, t.title, t.artist_id, p.name artist, p.followers, p.requests, p.launch, t.release_status status
    from tracks t join pop p on p.id = t.artist_id
    where t.parent_track_id is null and t.release_status in ('leaked', 'snippet') and t.cover_url is null and t.fan_cover_url is null
      and (p_artist is not null or p.launch or p.followers + p.requests > 0)
  ),
  thin as (
    select p.id artist_id, p.name artist, p.followers, p.requests, p.launch,
           (select count(*) from tracks t where t.artist_id = p.id) songs
    from pop p
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'links', (select count(*) from links), 'info', (select count(*) from info),
      'status', (select count(*) from status), 'leaks', (select count(*) from leaks),
      'thin', (select count(*) from thin where songs <= 10), 'covers', (select count(*) from covers)),
    'items', case p_kind
      when 'links' then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select id, track_id, url, link_title, source_domain, link_kind, suggested_status, title, artist_id, artist, score, votes
        from links order by launch desc, followers desc, requests desc, votes, artist, title, id
        offset greatest(p_offset, 0) limit 30) x)
      when 'info' then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select id, title, artist_id, artist, missing from info
        order by launch desc, followers desc, requests desc, artist, title, id offset greatest(p_offset, 0) limit 30) x)
      when 'status' then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select id, title, artist_id, artist from status
        order by launch desc, followers desc, requests desc, artist, title, id offset greatest(p_offset, 0) limit 30) x)
      when 'leaks' then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select id, title, artist_id, artist, missing, status from leaks
        order by launch desc, followers desc, requests desc, artist, title, id offset greatest(p_offset, 0) limit 30) x)
      when 'covers' then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select id, title, artist_id, artist, status from covers
        order by launch desc, followers desc, requests desc, artist, title, id offset greatest(p_offset, 0) limit 30) x)
      when 'thin' then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select artist_id, artist, songs, followers, requests from thin where songs <= 10
        order by followers desc, requests desc, songs, artist, artist_id offset greatest(p_offset, 0) limit 30) x)
    end);
$function$;
