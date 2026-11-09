-- Link checking, faster and smarter (9 Nov 2026).
--
-- verify-spotify-links checked one song per Spotify call (about 48 a day;
-- 20,905 links had never been checked). It now asks for 50 songs per call,
-- and as well as dead links it spots links that point at a DIFFERENT song
-- (neither the title nor the artist matches what Spotify says). Those are
-- not changed automatically: they're listed for a moderator on Clean-up →
-- Wrong links, and the song page shows "this link may be wrong".

create table if not exists spotify_link_issues (
  track_id text primary key references tracks(id) on delete cascade,
  spotify_url text not null,
  kind text not null default 'mismatch',
  spotify_title text,
  spotify_artists text,
  found_at timestamptz not null default now(),
  resolved text,             -- 'ok' (link is right) or 'cleared'
  resolved_by uuid,
  resolved_at timestamptz
);
alter table spotify_link_issues enable row level security;

-- Results from verify-spotify-links. p_items: [{track_id, url, found, title, artists}]
create or replace function sc_spotify_verify_save(p_secret text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare r record; v_dead int := 0; v_wrong int := 0; v_ok int := 0;
begin
  if p_secret is distinct from (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  for r in
    select x.track_id, x.url, x.found, x.title, x.artists, t.title t_title, t.aliases, t.spotify_url cur,
           a.name artist_name, t.credited_as, t.featured_artists
    from jsonb_to_recordset(p_items) x(track_id text, url text, found boolean, title text, artists text)
    join tracks t on t.id = x.track_id join artists a on a.id = t.artist_id
  loop
    continue when r.cur is distinct from r.url;  -- changed meanwhile
    if not r.found then
      -- Dead: clear it so the matcher looks for a replacement (as before).
      update tracks set spotify_url = null, spotify_search_attempted_at = null, spotify_link_verified_at = null where id = r.track_id;
      v_dead := v_dead + 1;
    else
      update tracks set spotify_link_verified_at = now() where id = r.track_id;
      -- Wrong song: neither the title nor any artist name matches.
      if sc_title_key(r.title) <> ''
         and position(sc_title_key(r.title) in sc_title_key(r.t_title || ' ' || coalesce(r.aliases, ''))) = 0
         and position(sc_title_key(r.t_title) in sc_title_key(r.title)) = 0
         and position(sc_title_key(r.artist_name) in sc_title_key(coalesce(r.artists, ''))) = 0
         and (r.credited_as is null or position(sc_title_key(r.credited_as) in sc_title_key(coalesce(r.artists, ''))) = 0)
         and not exists (select 1 from spotify_link_issues i where i.track_id = r.track_id and i.spotify_url = r.url and i.resolved = 'ok')
      then
        insert into spotify_link_issues (track_id, spotify_url, spotify_title, spotify_artists)
        values (r.track_id, r.url, left(r.title, 300), left(r.artists, 300))
        on conflict (track_id) do update set spotify_url = excluded.spotify_url, spotify_title = excluded.spotify_title,
          spotify_artists = excluded.spotify_artists, found_at = now(), resolved = null, resolved_by = null, resolved_at = null
        where spotify_link_issues.resolved is distinct from 'ok' or spotify_link_issues.spotify_url <> excluded.spotify_url;
        v_wrong := v_wrong + 1;
      else
        v_ok := v_ok + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', v_ok, 'dead', v_dead, 'wrong', v_wrong);
end $function$;
revoke execute on function sc_spotify_verify_save(text, jsonb) from public, anon, authenticated;

-- Moderators: the list and what to do with each.
create or replace function admin_link_issues(p_limit int default 300)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'count', (select count(*) from spotify_link_issues where resolved is null),
    'items', (select coalesce(jsonb_agg(x order by x.artist, x.title), '[]'::jsonb) from (
      select t.id, t.title, t.artist_id, a.name artist, t.release_status status, i.spotify_url, i.spotify_title, i.spotify_artists, i.found_at
      from spotify_link_issues i join tracks t on t.id = i.track_id join artists a on a.id = t.artist_id
      where i.resolved is null and t.spotify_url = i.spotify_url
      order by a.name, t.title limit greatest(1, least(coalesce(p_limit, 300), 1000))) x));
end $function$;
revoke execute on function admin_link_issues(int) from public, anon;
grant execute on function admin_link_issues(int) to authenticated;

create or replace function admin_link_issue_action(p_ids text[], p_action text)
returns int language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_action not in ('ok', 'clear') then raise exception 'unknown action'; end if;
  if p_action = 'clear' then
    perform sc_begin_batch('cleanup', 'Clean-up: cleared ' || cardinality(p_ids) || ' wrong Spotify link' || case when cardinality(p_ids) = 1 then '' else 's' end);
    update tracks t set spotify_url = null, spotify_search_attempted_at = now(), spotify_link_verified_at = null
    from spotify_link_issues i where i.track_id = t.id and t.id = any (p_ids) and t.spotify_url = i.spotify_url;
  end if;
  update spotify_link_issues set resolved = case p_action when 'ok' then 'ok' else 'cleared' end,
    resolved_by = auth.uid(), resolved_at = now()
  where track_id = any (p_ids) and resolved is null;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke execute on function admin_link_issue_action(text[], text) from public, anon;
grant execute on function admin_link_issue_action(text[], text) to authenticated;

-- Song page: flag a link that may be the wrong song.
do $$
declare d text := pg_get_functiondef('rpc_song_page(text)'::regprocedure);
begin
  d := regexp_replace(d, $r$'spotify_url', t\.spotify_url,$r$,
    $q$'spotify_url', t.spotify_url, 'link_issue', (select i.kind from spotify_link_issues i where i.track_id = t.id and i.resolved is null and i.spotify_url = t.spotify_url),$q$);
  if position('link_issue' in d) = 0 then raise exception 'song page patch failed'; end if;
  execute d;
end $$;
