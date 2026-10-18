-- Auto-approve rules for ChatGPT finds.
--
-- When a find comes in (or someone else confirms it), it's approved without
-- waiting for review if any switched-on rule matches:
--   official Spotify release  the find says "released" and has a Spotify
--                             track link
--   confirmed by N people     N different people's routines reported it
--                             (default 2)
--   trusted contributor       whoever found it has had at least N finds and
--                             submissions approved (default 25) and few
--                             dismissed (default at most 5%)
-- Never auto-approved: rumours, takedowns ("removed"), finds without a
-- status, and anything about a song with an open takedown request.
-- The confirmations and trusted rules also need the find's confidence to be
-- at least 0.6.
--
-- Each auto-approval is its own batch in the undo history, labelled with the
-- rule that approved it, and the find's review note says the same.
-- Settings and a log are on /admin/auto-approve.

create table if not exists auto_approve_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  spotify_releases boolean not null default true,
  min_confirmations int not null default 2,
  trusted_min_approved int not null default 25,
  trusted_max_dismissed_pct int not null default 5,
  updated_at timestamptz not null default now()
);
insert into auto_approve_settings (id) values (1) on conflict do nothing;
alter table auto_approve_settings enable row level security;
drop policy if exists auto_approve_settings_admin_read on auto_approve_settings;
create policy auto_approve_settings_admin_read on auto_approve_settings for select using ((select is_admin()));
revoke all on auto_approve_settings from anon;
revoke insert, update, delete on auto_approve_settings from authenticated;

-- A contributor's track record: approved and dismissed finds and submissions.
create or replace function sc_contributor_record(p_user uuid, out approved int, out dismissed int)
returns record
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    ((select count(*) from discoveries where first_seen_by = p_user and state = 'promoted')
     + (select count(*) from submissions where submitted_by = p_user and status = 'approved'))::int,
    ((select count(*) from discoveries where first_seen_by = p_user and state = 'dismissed')
     + (select count(*) from submissions where submitted_by = p_user and status = 'rejected'))::int;
$$;

-- Which rule (if any) approves this find.
create or replace function sc_auto_approve_reason(p_discovery uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  cfg auto_approve_settings%rowtype;
  d discoveries%rowtype;
  v_people int;
  rec record;
begin
  select * into cfg from auto_approve_settings where id = 1;
  if not coalesce(cfg.enabled, false) then return null; end if;
  select * into d from discoveries where id = p_discovery;
  if d.id is null or d.state <> 'open' then return null; end if;
  if d.to_status is null or d.to_status in ('removed', 'rumored') then return null; end if;
  if d.matched_track_id is not null and (
       exists (select 1 from tracks where id = d.matched_track_id and release_status = 'removed')
       or exists (select 1 from takedown_requests where track_id = d.matched_track_id and state = 'open')) then
    return null;
  end if;

  if cfg.spotify_releases and d.to_status = 'released' and exists (
       select 1 from discovery_evidence e
       where e.discovery_id = d.id and e.spotify_url ~ '^https://open\.spotify\.com/track/[A-Za-z0-9]{22}') then
    return 'official Spotify release';
  end if;

  if coalesce(d.confidence, 0) < 0.6 then return null; end if;

  if cfg.min_confirmations > 1 then
    select count(distinct user_id) into v_people from discovery_evidence where discovery_id = d.id;
    if v_people >= cfg.min_confirmations then
      return 'confirmed by ' || v_people || ' people';
    end if;
  end if;

  if cfg.trusted_min_approved > 0 and d.first_seen_by is not null then
    select * into rec from sc_contributor_record(d.first_seen_by);
    if rec.approved >= cfg.trusted_min_approved
       and rec.dismissed * 100 <= cfg.trusted_max_dismissed_pct * greatest(rec.approved + rec.dismissed, 1) then
      return 'trusted contributor';
    end if;
  end if;

  return null;
end;
$$;

-- Approve a find automatically if a rule matches. Never raises: a problem
-- just leaves the find in the review queue.
create or replace function sc_try_auto_approve(p_discovery uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_reason text;
  v_title text;
  v_claims text := current_setting('request.jwt.claims', true);
  v_batch text := current_setting('static_cuts.batch_id', true);
begin
  v_reason := sc_auto_approve_reason(p_discovery);
  if v_reason is null then return null; end if;
  select title || coalesce(' (' || version_hint || ')', '') into v_title from discoveries where id = p_discovery;

  begin
    -- Approve as the admin would, in its own undo batch.
    perform set_config('request.jwt.claims', '{"email":"dg.theswingingman@gmail.com","role":"authenticated"}', true);
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('auto_approve', 'Auto-approved: ' || coalesce(v_title, 'a find') || ' (' || v_reason || ')');
    perform approve_discovery(p_discovery, 'Auto-approved: ' || v_reason);
  exception when others then
    v_reason := null;
  end;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('static_cuts.batch_id', coalesce(v_batch, ''), true);
  return v_reason;
end;
$$;

-- New finds and confirmations are checked as they arrive.
create or replace function discovery_evidence_auto_approve()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform sc_try_auto_approve(new.discovery_id);
  return null;
end;
$$;
drop trigger if exists discovery_evidence_auto_approve on discovery_evidence;
create trigger discovery_evidence_auto_approve after insert on discovery_evidence
for each row execute function discovery_evidence_auto_approve();

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

create or replace function admin_auto_approve_settings()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when is_admin() then (
    select to_jsonb(s) || jsonb_build_object(
      'recent', (select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) from (
        select jsonb_build_object('at', d.reviewed_at, 'title', d.title || coalesce(' (' || d.version_hint || ')', ''),
          'artist_id', coalesce(d.main_artist_id, d.artist_id), 'artist', a.name, 'status', d.to_status,
          'reason', replace(d.review_note, 'Auto-approved: ', '')) x
        from discoveries d left join artists a on a.id = coalesce(d.main_artist_id, d.artist_id)
        where d.state = 'promoted' and d.review_note like 'Auto-approved:%'
        order by d.reviewed_at desc limit 50) r),
      'waiting', (select count(*) from discoveries where state = 'open'))
    from auto_approve_settings s where s.id = 1)
  end;
$$;

create or replace function admin_set_auto_approve(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  update auto_approve_settings set
    enabled = coalesce((p ->> 'enabled')::boolean, enabled),
    spotify_releases = coalesce((p ->> 'spotify_releases')::boolean, spotify_releases),
    min_confirmations = greatest(0, least(coalesce((p ->> 'min_confirmations')::int, min_confirmations), 10)),
    trusted_min_approved = greatest(0, least(coalesce((p ->> 'trusted_min_approved')::int, trusted_min_approved), 1000)),
    trusted_max_dismissed_pct = greatest(0, least(coalesce((p ->> 'trusted_max_dismissed_pct')::int, trusted_max_dismissed_pct), 50)),
    updated_at = now()
  where id = 1;
  return admin_auto_approve_settings();
end;
$$;

-- Apply the rules to finds already waiting (e.g. after changing settings).
create or replace function admin_auto_approve_waiting()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d record;
  n int := 0;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  for d in select id from discoveries where state = 'open' order by first_seen_at limit 200 loop
    if sc_try_auto_approve(d.id) is not null then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

revoke execute on function sc_contributor_record(uuid), sc_auto_approve_reason(uuid), sc_try_auto_approve(uuid),
  discovery_evidence_auto_approve() from public, anon, authenticated;
revoke execute on function admin_auto_approve_settings(), admin_set_auto_approve(jsonb), admin_auto_approve_waiting()
  from public, anon;
grant execute on function admin_auto_approve_settings(), admin_set_auto_approve(jsonb), admin_auto_approve_waiting()
  to authenticated;

-- What the rules would do to the finds waiting right now (nothing is
-- approved by this migration; use "apply to waiting finds" on the page).
select d.title, d.to_status, sc_auto_approve_reason(d.id) as would_auto_approve
from discoveries d where d.state = 'open' order by d.first_seen_at;
