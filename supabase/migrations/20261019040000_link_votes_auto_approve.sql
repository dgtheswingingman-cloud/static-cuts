-- Possible links go on the song once enough people vote they're right.
--
-- auto_approve_settings.link_votes (default 5, 0 = off): when a possible
-- link's score (right votes minus wrong votes) reaches it, it becomes the
-- song's listen link. Only for songs with no link yet, listening sites only,
-- never for removed songs or songs with an open takedown request, and only
-- while auto-approve is switched on.
-- Each one is its own entry in the undo history.

alter table auto_approve_settings add column if not exists link_votes int not null default 5;

create or replace function sc_try_link_vote_approve(p_candidate uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cfg auto_approve_settings%rowtype;
  c track_link_candidates%rowtype;
  t tracks%rowtype;
  v_score int;
  v_claims text := current_setting('request.jwt.claims', true);
  v_batch text := current_setting('static_cuts.batch_id', true);
  v_done text;
begin
  select * into cfg from auto_approve_settings where id = 1;
  if not coalesce(cfg.enabled, false) or coalesce(cfg.link_votes, 0) <= 0 then return null; end if;
  select * into c from track_link_candidates where id = p_candidate;
  if c.id is null then return null; end if;
  if c.source_domain !~* '(^|\.)(soundcloud\.com|youtube\.com|youtu\.be|bandcamp\.com|spotify\.com|music\.apple\.com|deezer\.com|tidal\.com|audiomack\.com)$' then
    return null;
  end if;
  select * into t from tracks where id = c.track_id;
  if t.id is null or t.spotify_url is not null or t.release_status = 'removed'
     or exists (select 1 from takedown_requests where track_id = t.id and state = 'open') then
    return null;
  end if;
  select coalesce(sum(vote), 0) into v_score from track_link_candidate_votes where candidate_id = c.id;
  if v_score < cfg.link_votes then return null; end if;

  begin
    perform set_config('request.jwt.claims', '{"email":"dg.theswingingman@gmail.com","role":"authenticated"}', true);
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('auto_approve', 'Link voted in: ' || t.title || ' (' || v_score || ' votes)');
    update tracks set spotify_url = c.url where id = t.id and spotify_url is null;
    v_done := 'voted in by ' || v_score;
  exception when others then
    v_done := null;
  end;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('static_cuts.batch_id', coalesce(v_batch, ''), true);
  return v_done;
end;
$$;

create or replace function track_link_votes_auto_approve()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform sc_try_link_vote_approve(new.candidate_id);
  return null;
end;
$$;
drop trigger if exists track_link_votes_auto_approve on track_link_candidate_votes;
create trigger track_link_votes_auto_approve after insert or update of vote on track_link_candidate_votes
for each row execute function track_link_votes_auto_approve();

-- Settings page: include link_votes and the recently voted-in links.
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
      'recent_links', (select coalesce(jsonb_agg(jsonb_build_object('at', b.created_at, 'label', b.label, 'undone', b.undone_at is not null)
                         order by b.created_at desc), '[]'::jsonb)
                       from (select * from change_batches where kind = 'auto_approve' and label like 'Link voted in:%'
                             order by created_at desc limit 30) b),
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
    link_votes = greatest(0, least(coalesce((p ->> 'link_votes')::int, link_votes), 50)),
    updated_at = now()
  where id = 1;
  return admin_auto_approve_settings();
end;
$$;

revoke execute on function sc_try_link_vote_approve(uuid), track_link_votes_auto_approve() from public, anon, authenticated;

-- Help wanted: keep showing links until they're voted in (or clearly wrong).
do $$
declare
  d text;
begin
  select pg_get_functiondef('public.rpc_help_wanted(text, boolean, int)'::regprocedure) into d;
  if d like '%c.score between -2 and 2%' then
    execute replace(d, 'c.score between -2 and 2', 'c.score > -3');
  end if;
end $$;
