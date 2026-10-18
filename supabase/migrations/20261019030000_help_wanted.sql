-- Help wanted (/help): small jobs anyone can do, busiest artists first.
--
--   links   possible listen links waiting for votes (songs with no link yet,
--           listening sites only, not already settled by votes, not ones
--           you've voted on)
--   info    released songs missing a release date or album
--   status  songs whose status is still unknown
--   thin    artists with 10 songs or fewer (run an import)
--
-- "Busiest" = followers, then requests in the last 30 days.
-- p_following limits everything to artists the viewer follows.

create or replace function rpc_help_wanted(p_kind text default 'links', p_following boolean default false,
                                           p_offset int default 0)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with me as (select auth.uid() as id),
  pop as (
    select a.id, a.name,
           (select count(*) from follows f where f.artist_id = a.id) followers,
           (select count(*) from artist_requests r where r.artist_id = a.id and r.created_at > now() - interval '30 days') requests
    from artists a, me
    where not p_following or exists (select 1 from follows f where f.user_id = me.id and f.artist_id = a.id)
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
  ),
  links as (
    select c.*, p.name artist, p.followers, p.requests from cand c join pop p on p.id = c.artist_id
    where c.score between -2 and 2
  ),
  info as (
    select t.id, t.title, t.artist_id, p.name artist, p.followers, p.requests,
           array_remove(array[case when t.release_date is null then 'release date' end,
                               case when t.album is null then 'album' end], null) missing
    from tracks t join pop p on p.id = t.artist_id
    where t.release_status = 'released' and (t.release_date is null or t.album is null)
  ),
  status as (
    select t.id, t.title, t.artist_id, p.name artist, p.followers, p.requests
    from tracks t join pop p on p.id = t.artist_id
    where coalesce(t.release_status, 'unconfirmed') = 'unconfirmed' and t.parent_track_id is null
      and p.followers + p.requests > 0
  ),
  thin as (
    select p.id artist_id, p.name artist, p.followers, p.requests,
           (select count(*) from tracks t where t.artist_id = p.id) songs
    from pop p
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'links', (select count(*) from links), 'info', (select count(*) from info),
      'status', (select count(*) from status), 'thin', (select count(*) from thin where songs <= 10)),
    'items', case p_kind
      when 'links' then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select id, track_id, url, link_title, source_domain, link_kind, suggested_status, title, artist_id, artist, score, votes
        from links order by followers desc, requests desc, votes, artist, title
        offset greatest(p_offset, 0) limit 30) x)
      when 'info' then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select id, title, artist_id, artist, missing from info
        order by followers desc, requests desc, artist, title offset greatest(p_offset, 0) limit 30) x)
      when 'status' then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select id, title, artist_id, artist from status
        order by followers desc, requests desc, artist, title offset greatest(p_offset, 0) limit 30) x)
      when 'thin' then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select artist_id, artist, songs, followers, requests from thin where songs <= 10
        order by followers desc, requests desc, songs, artist offset greatest(p_offset, 0) limit 30) x)
    end);
$$;

revoke execute on function rpc_help_wanted(text, boolean, int) from public;
grant execute on function rpc_help_wanted(text, boolean, int) to anon, authenticated;

create index if not exists track_link_candidates_track_idx on track_link_candidates (track_id);
create index if not exists track_link_candidate_votes_cand_idx on track_link_candidate_votes (candidate_id);
