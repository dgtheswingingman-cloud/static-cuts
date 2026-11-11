-- Covers for leaks.
--  * ChatGPT (or anyone through the connector) can suggest a cover: the image
--    and the page it's on. A moderator approves; the cover-copy job copies
--    the picture into our storage and it becomes a fan cover from that person.
--  * Leaks and snippets with no art show in the catalogue backlog as
--    "cover", and in Help wanted ("Missing covers").

create table if not exists public.cover_suggestions (
  id uuid primary key default gen_random_uuid(),
  track_id text not null references public.tracks(id) on delete cascade,
  image_url text not null,
  source_url text not null,
  notes text,
  submitted_by uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'live', 'rejected', 'failed')),
  note text,                 -- why it failed, or the reviewer's note
  fan_cover_id uuid,
  created_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  unique (track_id, image_url)
);
alter table public.cover_suggestions enable row level security;
create index if not exists cover_suggestions_status on public.cover_suggestions (status, created_at);

-- Songs that need art: leaks and snippets with no cover of their own or from fans.
create or replace function public.sc_track_needs(t tracks)
 returns text[] language sql stable parallel safe as $$
  select array_remove(array[
    case when t.parent_track_id is null and coalesce(t.release_status, 'unconfirmed') = 'unconfirmed' then 'status' end,
    case when t.spotify_url is null then 'link' end,
    case when t.parent_track_id is null and t.release_status = 'released'
          and (t.album is null or t.release_date is null or t.producers is null) then 'details' end,
    case when t.parent_track_id is null and t.release_status in ('leaked', 'snippet')
          and t.cover_url is null and t.fan_cover_url is null then 'cover' end
  ], null)
$$;

do $d$
declare src text := pg_get_functiondef('public.rpc_catalogue_backlog(text, text, integer, integer)'::regprocedure); n text;
begin
  n := replace(src, $q$p_kind not in ('status', 'link', 'details')$q$, $q$p_kind not in ('status', 'link', 'details', 'cover')$q$);
  n := replace(n, $q$raise exception 'kind must be status, link or details';$q$, $q$raise exception 'kind must be status, link, details or cover';$q$);
  if n = src then raise exception 'backlog not patched'; end if;
  execute n;
end $d$;

create or replace function public.rpc_suggest_cover(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); v_track tracks%rowtype;
  v_img text := nullif(trim(p ->> 'image_url'), ''); v_src text := nullif(trim(p ->> 'source_url'), '');
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into v_track from tracks where id = p ->> 'track_id';
  if v_track.id is null then raise exception 'unknown track_id'; end if;
  if v_img is null or v_img !~* '^https://[^ ]+$' then raise exception 'image_url must be an https link to the picture itself'; end if;
  if v_src is null or v_src !~* '^https?://[^ ]+$' then raise exception 'source_url must be the page the picture is on'; end if;
  update tracks set routine_checked_at = now() where id = v_track.id;
  if v_track.cover_url is not null then return jsonb_build_object('result', 'has_cover'); end if;
  if (select count(*) from cover_suggestions where submitted_by = uid and created_at > now() - interval '1 day') >= 200 then
    raise exception 'daily limit reached (200 cover suggestions a day)';
  end if;
  insert into cover_suggestions (track_id, image_url, source_url, notes, submitted_by)
  values (v_track.id, v_img, v_src, left(nullif(trim(p ->> 'notes'), ''), 1000), uid)
  on conflict (track_id, image_url) do nothing;
  return jsonb_build_object('result', case when found then 'sent' else 'duplicate' end);
end $$;
grant execute on function public.rpc_suggest_cover(jsonb) to authenticated;

-- Review.
create or replace function public.admin_cover_suggestions(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'counts', (select jsonb_object_agg(status, n) from (select status, count(*) n from cover_suggestions group by 1) c),
    'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (
      select s.*, t.title, t.release_status, a.id artist_id, a.name artist, (select display_name from profiles where id = s.submitted_by) by_name,
        sc_track_cover(t.id) current
      from cover_suggestions s join tracks t on t.id = s.track_id join artists a on a.id = t.artist_id
      where s.status = coalesce(p_status, 'pending') or (p_status = 'approved' and s.status in ('approved', 'failed'))
      order by s.created_at limit 300) x), '[]'));
end $$;

create or replace function public.admin_cover_suggestion_action(p_ids uuid[], p_action text, p_note text default null) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_action not in ('approve', 'reject') then raise exception 'approve or reject'; end if;
  update cover_suggestions set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
    note = nullif(trim(coalesce(p_note, '')), ''), reviewed_by = auth.uid(), reviewed_at = now()
  where id = any (p_ids) and status in ('pending', 'failed', case when p_action = 'reject' then 'approved' end);
  get diagnostics n = row_count;
  return n;
end $$;

-- The copy job: approved suggestions to copy, and the result.
create or replace function public.sc_cover_copy_next(p_secret text, p_limit int default 10) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'track_id', track_id, 'image_url', image_url)) from (
    select id, track_id, image_url from cover_suggestions where status = 'approved' order by reviewed_at limit p_limit) x), '[]');
end $$;

create or replace function public.sc_cover_copy_done(p_secret text, p_id uuid, p_url text, p_error text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare s cover_suggestions; v_cover uuid;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  select * into s from cover_suggestions where id = p_id;
  if s.id is null then return; end if;
  if p_url is null then
    update cover_suggestions set status = 'failed', note = left(coalesce(p_error, 'could not copy the picture'), 300) where id = p_id;
    return;
  end if;
  if exists (select 1 from tracks where id = s.track_id and cover_url is not null) then
    update cover_suggestions set status = 'rejected', note = 'the song has its own cover now' where id = p_id;
    return;
  end if;
  insert into track_fan_covers (track_id, user_id, url) values (s.track_id, s.submitted_by, p_url) returning id into v_cover;
  insert into track_fan_cover_votes (cover_id, user_id) values (v_cover, s.submitted_by) on conflict do nothing;
  -- a moderator approved it: count their say too, so it leads over unreviewed pictures
  if s.reviewed_by is not null and s.reviewed_by <> s.submitted_by then
    insert into track_fan_cover_votes (cover_id, user_id) values (v_cover, s.reviewed_by) on conflict do nothing;
  end if;
  perform sc_fan_cover_refresh(s.track_id);
  update cover_suggestions set status = 'live', fan_cover_id = v_cover where id = p_id;
end $$;

revoke execute on function public.sc_cover_copy_next(text, int), public.sc_cover_copy_done(text, uuid, text, text) from anon, authenticated, public;

-- Counts and the inbox.
do $d$
declare src text; n text;
begin
  src := pg_get_functiondef('public.rpc_moderation_counts()'::regprocedure);
  n := replace(src, $q$'wrong_links', (select count(*) from spotify_link_issues where resolved is null)$q$,
    $q$'wrong_links', (select count(*) from spotify_link_issues where resolved is null),
    'covers', (select count(*) from cover_suggestions where status in ('pending', 'failed'))$q$);
  if n = src then raise exception 'counts not patched'; end if;
  execute n;
  src := pg_get_functiondef('public.rpc_review_inbox(integer)'::regprocedure);
  n := replace(src, $q$      union all
      select 4, 'sheet',$q$, $q$      union all
      select 4, 'cover', 'Cover suggestion', (select t.title from tracks t where t.id = c.track_id),
             (select a.name from tracks t join artists a on a.id = t.artist_id where t.id = c.track_id), c.created_at, '/review/covers'
      from cover_suggestions c where c.status in ('pending', 'failed')
      union all
      select 4, 'sheet',$q$);
  if n = src then raise exception 'inbox not patched'; end if;
  execute n;
end $d$;

-- Help wanted: "Missing covers" (leaks and snippets with no art, most-followed first).
do $d$
declare src text := pg_get_functiondef('public.rpc_help_wanted(text, boolean, integer)'::regprocedure); n text;
begin
  n := replace(src, $q$  thin as ($q$, $q$  covers as (
    select t.id, t.title, t.artist_id, p.name artist, p.followers, p.requests, t.release_status status
    from tracks t join pop p on p.id = t.artist_id
    where t.parent_track_id is null and t.release_status in ('leaked', 'snippet') and t.cover_url is null and t.fan_cover_url is null
      and p.followers + p.requests > 0
  ),
  thin as ($q$);
  n := replace(n, $q$'thin', (select count(*) from thin where songs <= 10)),$q$, $q$'thin', (select count(*) from thin where songs <= 10), 'covers', (select count(*) from covers)),$q$);
  n := replace(n, $q$      when 'thin' then$q$, $q$      when 'covers' then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select id, title, artist_id, artist, status from covers
        order by followers desc, requests desc, artist, title offset greatest(p_offset, 0) limit 30) x)
      when 'thin' then$q$);
  if n = src or position('covers as' in n) = 0 or position('''covers'', (select' in n) = 0 then raise exception 'help not patched'; end if;
  execute n;
end $d$;

-- The copy job, every 2 minutes when something's approved.
select cron.schedule('cover-copy', '*/2 * * * *', $c$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := jsonb_build_object('fn', 'cover-copy', 'body', jsonb_build_object()),
    timeout_milliseconds := 15000)
  where exists (select 1 from public.cover_suggestions where status = 'approved');
$c$);
