-- Community pack (run after 20261021000000_tracker_statuses.sql):
--  1. Trusted contributors: 25+ approved suggestions (and few rejections)
--     and your suggestions go live straight away. Moderators can take it
--     back, or give it early.
--  2. Second opinions: anyone signed in can answer "is this a version of
--     that song?"; two matching answers settle it without a moderator.
--  3. Most wanted: vote for the unreleased songs you want most.
--  4. This week: a shareable weekly roundup of leaks and releases.
--  5. Year in review for your collection.
--  6. Phone alerts (web push) for your notifications.
--  7. Import your own spreadsheet into your collection.
--  8. Public data access with keys the admin hands out.
--  9. Faster artist pages: one request for every song, one for your marks.

-- ----------------------------------------------------------------- 1

create table if not exists user_trust (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state text not null check (state in ('granted', 'revoked')),
  note text,
  set_by uuid,
  set_at timestamptz not null default now()
);
alter table user_trust enable row level security;
revoke all on user_trust from anon, authenticated;

-- How much someone's suggestions have been trusted so far.
create or replace function sc_trust_stats(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with s as (
    select count(*) filter (where status = 'approved') approved,
           count(*) filter (where status = 'rejected') rejected
    from submissions where submitted_by = p_user
  ),
  o as (select state from user_trust where user_id = p_user)
  select jsonb_build_object(
    'approved', s.approved, 'rejected', s.rejected, 'needed', 25,
    'override', (select state from o),
    'trusted', case
      when (select state from o) = 'granted' then true
      when (select state from o) = 'revoked' then false
      else s.approved >= 25 and s.rejected * 5 <= s.approved end)
  from s;
$$;
revoke execute on function sc_trust_stats(uuid) from public, anon, authenticated;

create or replace function sc_is_trusted(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$ select coalesce((sc_trust_stats(p_user) ->> 'trusted')::boolean, false); $$;
revoke execute on function sc_is_trusted(uuid) from public, anon, authenticated;

-- For "my submissions" and profiles.
create or replace function rpc_my_trust()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$ select case when auth.uid() is not null then sc_trust_stats(auth.uid()) end; $$;
grant execute on function rpc_my_trust() to authenticated;

create or replace function rpc_is_trusted(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$ select sc_is_trusted(p_user); $$;
grant execute on function rpc_is_trusted(uuid) to anon, authenticated;

-- A trusted step may do what a moderator's approval does, only inside the
-- functions below (the flag is set and cleared within one database call).
create or replace function is_moderator()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select is_admin()
    or coalesce(current_setting('static_cuts.trusted_apply', true), '') = 'on'
    or (not is_oauth_client() and exists (select 1 from moderators where user_id = auth.uid()));
$$;

-- Trusted contributors' suggestions are applied as soon as they're sent.
-- Deleting a song and adding a new artist still always wait for a
-- moderator. If applying fails for any reason, it simply waits as usual.
create or replace function submissions_trusted_apply()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status <> 'pending' or new.submitted_by is null or new.submitted_by is distinct from auth.uid()
     or new.type not in ('new_track', 'new_version', 'correction', 'status_change', 'flag_link')
     or not sc_is_trusted(new.submitted_by) then
    return null;
  end if;
  begin
    perform set_config('static_cuts.trusted_apply', 'on', true);
    perform sc_begin_batch('trusted', 'Trusted contributor: ' || replace(new.type, '_', ' '));
    if new.type = 'status_change' then
      perform approve_status_change(new.id, 'Trusted contributor: applied straight away.');
    else
      perform approve_submission(new.id, '{}', 'Trusted contributor: applied straight away.');
    end if;
    perform set_config('static_cuts.trusted_apply', '', true);
  exception when others then
    perform set_config('static_cuts.trusted_apply', '', true);
  end;
  return null;
end;
$$;
drop trigger if exists submissions_trusted_apply on submissions;
create trigger submissions_trusted_apply after insert on submissions
  for each row execute function submissions_trusted_apply();

-- Moderators: give or take back trusted status ("auto" = by the numbers).
create or replace function admin_set_user_trust(p_user uuid, p_state text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_state = 'auto' then
    delete from user_trust where user_id = p_user;
  elsif p_state in ('granted', 'revoked') then
    insert into user_trust (user_id, state, note, set_by) values (p_user, p_state, p_note, auth.uid())
    on conflict (user_id) do update set state = excluded.state, note = excluded.note, set_by = excluded.set_by, set_at = now();
  else
    raise exception 'unknown state';
  end if;
  return sc_trust_stats(p_user);
end;
$$;
revoke execute on function admin_set_user_trust(uuid, text, text) from public, anon;
grant execute on function admin_set_user_trust(uuid, text, text) to authenticated;

-- Moderators: everyone who has sent suggestions, with their record.
create or replace function admin_contributor_trust()
returns table (user_id uuid, name text, approved bigint, rejected bigint, pending bigint, trusted boolean, override text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.submitted_by, coalesce(p.display_name, 'someone'),
         count(*) filter (where s.status = 'approved'),
         count(*) filter (where s.status = 'rejected'),
         count(*) filter (where s.status = 'pending'),
         sc_is_trusted(s.submitted_by), (select state from user_trust u where u.user_id = s.submitted_by)
  from submissions s left join profiles p on p.id = s.submitted_by
  where is_moderator() and s.submitted_by is not null
  group by s.submitted_by, p.display_name
  order by 3 desc;
$$;
revoke execute on function admin_contributor_trust() from public, anon;
grant execute on function admin_contributor_trust() to authenticated;

-- ----------------------------------------------------------------- 2

create table if not exists version_votes (
  suggestion_id uuid not null references version_suggestions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  vote boolean not null,
  created_at timestamptz not null default now(),
  primary key (suggestion_id, user_id)
);
alter table version_votes enable row level security;
revoke all on version_votes from anon, authenticated;

-- Sub-versions waiting for a look that you haven't answered, artists you
-- follow first.
create or replace function rpc_version_questions(p_limit int default 20)
returns table (id uuid, track_id text, track_title text, artist_id text, artist text, version text,
               parent_track_id text, parent_title text, parent_artist text, yes bigint, no bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select v.id, t.id, t.title, t.artist_id, a.name, v.version, p.id, p.title, pa.name,
         (select count(*) from version_votes x where x.suggestion_id = v.id and x.vote),
         (select count(*) from version_votes x where x.suggestion_id = v.id and not x.vote)
  from version_suggestions v
  join tracks t on t.id = v.track_id
  join artists a on a.id = t.artist_id
  join tracks p on p.id = v.parent_track_id
  join artists pa on pa.id = p.artist_id
  where v.state = 'open' and v.action = 'link' and v.cls in ('check', 'cross')
    and auth.uid() is not null
    and not exists (select 1 from version_votes x where x.suggestion_id = v.id and x.user_id = auth.uid())
  order by exists (select 1 from follows f where f.user_id = auth.uid() and f.artist_id = t.artist_id) desc,
           (select count(*) from version_votes x where x.suggestion_id = v.id) desc, v.created_at
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;
revoke execute on function rpc_version_questions(int) from public, anon;
grant execute on function rpc_version_questions(int) to authenticated;

-- Answer one. Two "yes" and no "no" links it; two "no" and no "yes"
-- dismisses it; a split stays for a moderator.
create or replace function rpc_vote_version(p_id uuid, p_vote boolean)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yes int;
  v_no int;
  v_recent int;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if is_oauth_client() then raise exception 'not authorized'; end if;
  select count(*) into v_recent from version_votes where user_id = auth.uid() and created_at > now() - interval '1 hour';
  if v_recent >= 200 then raise exception 'That''s a lot of answers in an hour. Take a breather.'; end if;
  if not exists (select 1 from version_suggestions where id = p_id and state = 'open') then return 'closed'; end if;
  insert into version_votes (suggestion_id, user_id, vote) values (p_id, auth.uid(), p_vote)
  on conflict (suggestion_id, user_id) do update set vote = excluded.vote, created_at = now();
  select count(*) filter (where vote), count(*) filter (where not vote) into v_yes, v_no
  from version_votes where suggestion_id = p_id;
  if v_yes >= 2 and v_no = 0 then
    perform set_config('static_cuts.trusted_apply', 'on', true);
    perform sc_begin_batch('sub_versions', 'Sub-versions: settled by two people agreeing');
    perform sc_apply_version_suggestions(array[p_id]);
    perform set_config('static_cuts.trusted_apply', '', true);
    return 'linked';
  elsif v_no >= 2 and v_yes = 0 then
    update version_suggestions set state = 'dismissed', decided_at = now() where id = p_id and state = 'open';
    return 'dismissed';
  end if;
  return 'waiting';
end;
$$;
revoke execute on function rpc_vote_version(uuid, boolean) from public, anon;
grant execute on function rpc_vote_version(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------- 3

create table if not exists wanted_votes (
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id text not null references tracks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);
create index if not exists wanted_votes_track on wanted_votes (track_id);
alter table wanted_votes enable row level security;
revoke all on wanted_votes from anon, authenticated;

-- Want / don't want a song. Only songs that aren't out yet.
create or replace function rpc_toggle_wanted(p_track_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_on boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if is_oauth_client() then raise exception 'not authorized'; end if;
  if exists (select 1 from wanted_votes where user_id = auth.uid() and track_id = p_track_id) then
    delete from wanted_votes where user_id = auth.uid() and track_id = p_track_id;
    v_on := false;
  else
    if exists (select 1 from tracks where id = p_track_id and release_status = 'released') then
      raise exception 'That one''s already out.';
    end if;
    insert into wanted_votes (user_id, track_id) values (auth.uid(), p_track_id);
    v_on := true;
  end if;
  return jsonb_build_object('wanted', v_on, 'count', (select count(*) from wanted_votes where track_id = p_track_id));
end;
$$;
revoke execute on function rpc_toggle_wanted(text) from public, anon;
grant execute on function rpc_toggle_wanted(text) to authenticated;

create or replace function rpc_wanted_state(p_track_id text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'count', (select count(*) from wanted_votes where track_id = p_track_id),
    'wanted', auth.uid() is not null and exists (select 1 from wanted_votes where track_id = p_track_id and user_id = auth.uid()));
$$;
grant execute on function rpc_wanted_state(text) to anon, authenticated;

-- The most wanted songs that aren't out, for one artist or everyone.
create or replace function rpc_most_wanted(p_artist_id text default null, p_limit int default 50)
returns table (track_id text, title text, artist_id text, artist text, release_status text, votes bigint, wanted boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select t.id, t.title, t.artist_id, a.name, coalesce(t.release_status, 'unconfirmed'), count(*),
         bool_or(w.user_id = auth.uid())
  from wanted_votes w
  join tracks t on t.id = w.track_id
  join artists a on a.id = t.artist_id
  where coalesce(t.release_status, '') <> 'released'
    and (p_artist_id is null or t.artist_id = p_artist_id)
  group by t.id, t.title, t.artist_id, a.name, t.release_status
  order by count(*) desc, t.title
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;
grant execute on function rpc_most_wanted(text, int) to anon, authenticated;

-- ----------------------------------------------------------------- 4

-- One week's news (Monday to Sunday, UK time): songs that leaked or came
-- out that week (by their dates), songs the site newly marked leaked or
-- released, and how much was added. Archive corrections from trackers
-- aren't news, so they're left out of "newly marked".
create or replace function rpc_weekly(p_week_start date default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with w as (
    select coalesce(p_week_start, date_trunc('week', (now() at time zone 'Europe/London'))::date) d
  ),
  r as (select d, d + 7 e, (d::timestamp at time zone 'Europe/London') s_at, ((d + 7)::timestamp at time zone 'Europe/London') e_at from w),
  dated as (
    select 'leaked' kind, t.id, t.title, t.artist_id, a.name artist, t.leak_date as day, t.spotify_url
    from tracks t join artists a on a.id = t.artist_id, r
    where t.leak_date >= r.d and t.leak_date < r.e and t.parent_track_id is null
    union all
    select 'released', t.id, t.title, t.artist_id, a.name, t.release_date, t.spotify_url
    from tracks t join artists a on a.id = t.artist_id, r
    where t.release_date >= r.d and t.release_date < r.e and t.parent_track_id is null and t.release_status = 'released'
  ),
  marked as (
    select distinct on (t.id) e.to_status kind, t.id, t.title, t.artist_id, a.name artist, e.created_at at_ts, t.spotify_url
    from track_status_events e join tracks t on t.id = e.track_id join artists a on a.id = t.artist_id, r
    where e.created_at >= r.s_at and e.created_at < r.e_at and e.source_note is null
      and e.to_status in ('leaked', 'released', 'snippet', 'announced')
      and e.from_status is distinct from e.to_status
      and not exists (select 1 from dated d where d.id = t.id)
    order by t.id, e.created_at desc
  ),
  added as (
    select t.artist_id, a.name artist, count(*) n
    from tracks t join artists a on a.id = t.artist_id, r
    where t.created_at >= r.s_at and t.created_at < r.e_at
    group by t.artist_id, a.name
  )
  select jsonb_build_object(
    'week_start', (select d from r),
    'leaked', coalesce((select jsonb_agg(to_jsonb(x) order by x.day, x.artist) from dated x where kind = 'leaked'), '[]'::jsonb),
    'released', coalesce((select jsonb_agg(to_jsonb(x) order by x.day, x.artist) from dated x where kind = 'released'), '[]'::jsonb),
    'marked', coalesce((select jsonb_agg(to_jsonb(x) order by x.at_ts desc) from (select * from marked limit 60) x), '[]'::jsonb),
    'added_total', coalesce((select sum(n) from added), 0),
    'added_top', coalesce((select jsonb_agg(to_jsonb(x) order by x.n desc) from (select * from added order by n desc limit 8) x), '[]'::jsonb),
    'wanted_top', coalesce((select jsonb_agg(to_jsonb(x)) from rpc_most_wanted(null, 5) x), '[]'::jsonb));
$$;
grant execute on function rpc_weekly(date) to anon, authenticated;

-- ----------------------------------------------------------------- 5

-- Your year: what you collected, rated and helped with.
create or replace function rpc_year_review(p_year int default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with y as (
    select coalesce(p_year, extract(year from now())::int) yr, auth.uid() me
  ),
  col as (
    select o.track_id, t.title, t.artist_id, a.name artist, coalesce(t.release_status, 'unconfirmed') status,
           (select count(*) from track_ownership o2 where o2.track_id = o.track_id) holders
    from track_ownership o join tracks t on t.id = o.track_id join artists a on a.id = t.artist_id, y
    where o.user_id = y.me and extract(year from o.collected_at) = y.yr
  )
  select case when (select me from y) is null then null else jsonb_build_object(
    'year', (select yr from y),
    'collected', (select count(*) from col),
    'unreleased_collected', (select count(*) from col where status <> 'released'),
    'artists', (select count(distinct artist_id) from col),
    'top_artists', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select artist_id, artist, count(*) n from col group by artist_id, artist order by n desc limit 5) x), '[]'::jsonb),
    'rarest', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select track_id, title, artist, holders from col order by holders, title limit 5) x), '[]'::jsonb),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from col group by status) x), '{}'::jsonb),
    'ratings', (select count(*) from ratings r, y where r.user_id = y.me and extract(year from r.updated_at) = y.yr),
    'top_rated', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select t.id track_id, t.title, a.name artist, r.value from ratings r join tracks t on t.id = r.track_id
        join artists a on a.id = t.artist_id, y
        where r.user_id = y.me and extract(year from r.updated_at) = y.yr order by r.value desc, r.updated_at desc limit 5) x), '[]'::jsonb),
    'follows', (select count(*) from follows f, y where f.user_id = y.me and extract(year from f.followed_at) = y.yr),
    'approved_suggestions', (select count(*) from submissions s, y where s.submitted_by = y.me and s.status = 'approved'
                             and extract(year from s.created_at) = y.yr),
    'comments', (select count(*) from comments c, y where c.user_id = y.me and extract(year from c.created_at) = y.yr)
  ) end;
$$;
grant execute on function rpc_year_review(int) to authenticated;

-- ----------------------------------------------------------------- 6

create table if not exists push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  failed_at timestamptz
);
create index if not exists push_subscriptions_user on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;
revoke all on push_subscriptions from anon, authenticated;
alter table notifications add column if not exists pushed_at timestamptz;

create or replace function rpc_push_subscribe(p_endpoint text, p_p256dh text, p_auth text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null or is_oauth_client() then raise exception 'Sign in first.'; end if;
  if p_endpoint !~ '^https://' then raise exception 'bad subscription'; end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, failed_at = null;
  return true;
end;
$$;
revoke execute on function rpc_push_subscribe(text, text, text) from public, anon;
grant execute on function rpc_push_subscribe(text, text, text) to authenticated;

create or replace function rpc_push_unsubscribe(p_endpoint text)
returns boolean
language sql
security definer
set search_path to 'public'
as $$
  with d as (delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid() returning 1)
  select exists (select 1 from d);
$$;
revoke execute on function rpc_push_unsubscribe(text) from public, anon;
grant execute on function rpc_push_unsubscribe(text) to authenticated;

-- For the push timer: new personal notifications for people with phone
-- alerts on (admin alerts stay on the site).
create or replace function sc_push_next(p_secret text, p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v jsonb;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  with picked as (
    select n.id from notifications n
    where n.pushed_at is null and n.kind <> 'admin' and n.created_at > now() - interval '1 day'
      and exists (select 1 from push_subscriptions s where s.user_id = n.user_id and s.failed_at is null)
    order by n.created_at limit greatest(1, least(coalesce(p_limit, 50), 200))
  ),
  marked as (
    update notifications n set pushed_at = now() from picked where n.id = picked.id
    returning n.id, n.user_id, n.title, n.body, n.link
  )
  select coalesce(jsonb_agg(jsonb_build_object('title', m.title, 'body', m.body, 'link', m.link,
           'subs', (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                    from push_subscriptions s where s.user_id = m.user_id and s.failed_at is null))), '[]'::jsonb)
  into v from marked m;
  -- Old ones nobody will want pushed any more.
  update notifications set pushed_at = now() where pushed_at is null and created_at <= now() - interval '1 day';
  return v;
end;
$$;
revoke execute on function sc_push_next(text, int) from public, anon, authenticated;
grant execute on function sc_push_next(text, int) to service_role;

create or replace function sc_push_failed(p_secret text, p_endpoints text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  update push_subscriptions set failed_at = now() where endpoint = any (p_endpoints);
end;
$$;
revoke execute on function sc_push_failed(text, text[]) from public, anon, authenticated;
grant execute on function sc_push_failed(text, text[]) to service_role;

-- Existing notifications aren't pushed retroactively.
update notifications set pushed_at = now() where pushed_at is null;

select cron.unschedule('push-alerts') where exists (select 1 from cron.job where jobname = 'push-alerts');
select cron.schedule('push-alerts', '*/2 * * * *', $job$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

-- ----------------------------------------------------------------- 7

-- Match rows from your own spreadsheet ({artist, title}) to songs here.
-- Nothing is saved; the page shows the matches first.
create or replace function rpc_match_my_songs(p_items jsonb, p_artist_id text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  it jsonb;
  v_artist text;
  v_track text;
  v_title text;
  out jsonb := '[]'::jsonb;
  n int := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    n := n + 1;
    exit when n > 3000;
    v_artist := coalesce(p_artist_id, sc_find_artist(it ->> 'artist'));
    v_track := null;
    v_title := null;
    if v_artist is not null then
      select t.id, t.title into v_track, v_title
      from track_title_keys tk join tracks t on t.id = tk.track_id
      where tk.artist_id = v_artist and tk.key = sc_title_key(it ->> 'title') and tk.key <> ''
      order by tk.is_main desc limit 1;
      if v_track is null then
        select t.id, t.title into v_track, v_title
        from track_title_keys tk join tracks t on t.id = tk.track_id
        where tk.artist_id = v_artist and tk.song_key = sc_song_key(it ->> 'title') and tk.song_key <> ''
        order by tk.is_main desc limit 1;
      end if;
    end if;
    out := out || jsonb_build_array(jsonb_build_object(
      'row', n, 'artist_in', it ->> 'artist', 'title_in', it ->> 'title', 'artist_id', v_artist,
      'track_id', v_track, 'title', v_title,
      'owned', v_track is not null and exists (select 1 from track_ownership where user_id = auth.uid() and track_id = v_track)));
  end loop;
  return out;
end;
$$;
revoke execute on function rpc_match_my_songs(jsonb, text) from public, anon;
grant execute on function rpc_match_my_songs(jsonb, text) to authenticated;

create or replace function rpc_collect_many(p_track_ids text[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n int;
begin
  if auth.uid() is null or is_oauth_client() then raise exception 'Sign in first.'; end if;
  insert into track_ownership (user_id, track_id)
  select auth.uid(), t.id from tracks t where t.id = any (p_track_ids[1:3000])
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function rpc_collect_many(text[]) from public, anon;
grant execute on function rpc_collect_many(text[]) to authenticated;

-- ----------------------------------------------------------------- 8

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text not null unique,
  key_hint text not null,
  per_minute int not null default 60,
  per_day int not null default 5000,
  created_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);
alter table api_keys enable row level security;
revoke all on api_keys from anon, authenticated;

create table if not exists api_key_usage (
  key_id uuid not null references api_keys(id) on delete cascade,
  minute timestamptz not null,
  calls int not null default 0,
  primary key (key_id, minute)
);
alter table api_key_usage enable row level security;
revoke all on api_key_usage from anon, authenticated;

-- Admin: make a key. The key itself is shown once and only its hash kept.
create or replace function admin_create_api_key(p_name text, p_per_minute int default 60, p_per_day int default 5000)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_key text := 'sc_' || encode(gen_random_bytes(24), 'hex');
  v_id uuid;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the key a name (who it''s for).'; end if;
  insert into api_keys (name, key_hash, key_hint, per_minute, per_day, created_by)
  values (trim(p_name), encode(digest(v_key, 'sha256'), 'hex'), right(v_key, 4),
          greatest(1, least(coalesce(p_per_minute, 60), 600)), greatest(1, least(coalesce(p_per_day, 5000), 100000)), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'key', v_key);
end;
$$;
revoke execute on function admin_create_api_key(text, int, int) from public, anon;
grant execute on function admin_create_api_key(text, int, int) to authenticated;

create or replace function admin_api_keys()
returns table (id uuid, name text, key_hint text, per_minute int, per_day int, created_at timestamptz,
               revoked_at timestamptz, last_used_at timestamptz, calls_today bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select k.id, k.name, k.key_hint, k.per_minute, k.per_day, k.created_at, k.revoked_at, k.last_used_at,
         (select coalesce(sum(u.calls), 0) from api_key_usage u where u.key_id = k.id and u.minute > now() - interval '24 hours')
  from api_keys k where is_admin() order by k.revoked_at nulls first, k.created_at desc;
$$;
revoke execute on function admin_api_keys() from public, anon;
grant execute on function admin_api_keys() to authenticated;

create or replace function admin_revoke_api_key(p_id uuid)
returns boolean
language sql
security definer
set search_path to 'public'
as $$
  update api_keys set revoked_at = now() where id = p_id and is_admin() and revoked_at is null returning true;
$$;
revoke execute on function admin_revoke_api_key(uuid) from public, anon;
grant execute on function admin_revoke_api_key(uuid) to authenticated;

-- For the public-api function: is this key good, and within its limits?
-- Returns the key's name, or an error word.
create or replace function sc_api_key_check(p_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  k api_keys%rowtype;
  this_min timestamptz := date_trunc('minute', now());
  used_min int;
  used_day int;
begin
  select * into k from api_keys where key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex');
  if k.id is null or k.revoked_at is not null then return jsonb_build_object('error', 'bad_key'); end if;
  perform pg_advisory_xact_lock(hashtext('apikey_' || k.id::text));
  select coalesce(sum(calls), 0) into used_min from api_key_usage where key_id = k.id and minute = this_min;
  select coalesce(sum(calls), 0) into used_day from api_key_usage where key_id = k.id and minute > now() - interval '24 hours';
  if used_min >= k.per_minute or used_day >= k.per_day then return jsonb_build_object('error', 'rate_limited'); end if;
  insert into api_key_usage (key_id, minute, calls) values (k.id, this_min, 1)
  on conflict (key_id, minute) do update set calls = api_key_usage.calls + 1;
  update api_keys set last_used_at = now() where id = k.id;
  return jsonb_build_object('name', k.name);
end;
$$;
revoke execute on function sc_api_key_check(text) from public, anon, authenticated;
grant execute on function sc_api_key_check(text) to service_role;

-- Old usage counts go with the daily tidy.
create or replace function sc_api_budget_tidy()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from api_budget where minute < now() - interval '3 days';
  delete from api_key_usage where minute < now() - interval '3 days';
  delete from change_batches where created_at < now() - interval '6 months';
  delete from cron.job_run_details where start_time < now() - interval '14 days';
end;
$$;
revoke execute on function sc_api_budget_tidy() from public, anon, authenticated;

-- ----------------------------------------------------------------- 9

-- Every song on an artist's page in one go (their own and the ones they
-- appear on), with only what the list needs. Big pages (Kanye: 3,800+
-- songs) used to take several requests one after another.
create or replace function rpc_artist_tracks(p_artist_id text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(x order by x ->> 'title'), '[]'::jsonb) from (
    select jsonb_build_object('id', t.id, 'title', t.title, 'spotify_url', t.spotify_url, 'parent_track_id', t.parent_track_id,
             'is_featured', t.is_featured, 'is_official', t.is_official, 'aliases', t.aliases,
             'release_status', t.release_status, 'source', t.source, 'source_url', t.source_url) x
    from tracks t where t.artist_id = p_artist_id
    union all
    select jsonb_build_object('id', t.id, 'title', t.title, 'spotify_url', t.spotify_url, 'parent_track_id', t.parent_track_id,
             'is_featured', true, 'is_official', t.is_official, 'aliases', t.aliases,
             'release_status', t.release_status, 'source', t.source, 'source_url', t.source_url,
             'isCrossAppearance', true, 'homeArtistId', t.artist_id, 'homeArtistName', a.name)
    from track_appearances ap join tracks t on t.id = ap.track_id join artists a on a.id = t.artist_id
    where ap.artist_id = p_artist_id and t.artist_id <> p_artist_id
  ) s;
$$;
grant execute on function rpc_artist_tracks(text) to anon, authenticated;

-- Your collection ticks and ratings for one artist's page. (Asking with
-- every song id in the address broke on big pages.)
create or replace function rpc_my_artist_marks(p_artist_id text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with ids as (
    select id from tracks where artist_id = p_artist_id
    union
    select track_id from track_appearances where artist_id = p_artist_id
  )
  select case when auth.uid() is null then null else jsonb_build_object(
    'owned', (select coalesce(jsonb_agg(o.track_id), '[]'::jsonb) from track_ownership o join ids on ids.id = o.track_id
              where o.user_id = auth.uid()),
    'ratings', (select coalesce(jsonb_object_agg(r.track_id, r.value), '{}'::jsonb) from ratings r join ids on ids.id = r.track_id
                where r.user_id = auth.uid())) end;
$$;
grant execute on function rpc_my_artist_marks(text) to authenticated;

select 'done' as result;
