-- Clean-up check (8 Nov 2026).
--
-- 1. Duplicate auto-merge learns two more sure cases on one artist's page:
--    a. empty copies: same title, no link, no ISRC, no length, no album, no
--       producers, no versions, nobody has collected/rated/commented it.
--       Merged into the fullest copy of that title. Generic titles ("Intro",
--       "Interlude", "Untitled"...) are left alone.
--    b. deluxe copies: same title on the same album once "(Deluxe)",
--       "(Expanded Edition)", "- Remastered" etc. are ignored, with the same
--       length (or no length) and no clashing ISRC. Generic titles left alone.
-- 2. Download-site tags in titles ("Intro-(www.warezcorps.com)") are cut off
--    hourly; the old title is kept as an alias.
-- 3. /review/cleanup: entries that don't look like songs (interviews,
--    podcasts, full-album uploads, tracklists...) and empty placeholder
--    entries ("???", "Unknown Song 3" with nothing on them), for a person to
--    delete or keep. Nothing is deleted automatically.

-- ---------- 1. Duplicate auto-merge ----------
create or replace function sc_album_base(p text)
returns text language sql immutable parallel safe as $$
  select nullif(sc_title_key(regexp_replace(lower(coalesce(p, '')),
    '\s*([\(\[]|-\s)\s*(super deluxe|deluxe|expanded|complete|special|anniversary|remaster(ed)?|bonus|edition|version|explicit|clean)[^\)\]]*[\)\]]?\s*$', '')), '')
$$;

create or replace function sc_duplicate_auto_merge(p_limit int default 200)
returns int language plpgsql security definer set search_path to 'public' as $function$
declare g record; v_keep text; v_rest text[]; n int := 0;
begin
  -- The same pass the hourly version clean-up uses to merge.
  perform set_config('static_cuts.system_job', 'version-auto-clear', true);
  for g in
    -- Same title on one page, from the precomputed title keys (fast).
    with dup as (
      select k.artist_id, k.key, k.track_id, k.generic from track_title_keys k
      where k.is_main and k.key <> ''
        and (k.artist_id, k.key) in (select artist_id, key from track_title_keys where is_main and key <> ''
                                      group by 1, 2 having count(*) > 1)
    ),
    t as (
      select d.artist_id, d.key, d.generic, t.id, t.spotify_url, t.isrc, t.length_sec, t.created_at,
             case when t.album is not null then sc_title_key(t.album) end ak,
             case when t.album is not null then sc_album_base(t.album) end ab,
             (t.spotify_url is null and t.isrc is null and t.length_sec is null and t.album is null and t.producers is null
              and t.deezer_url is null and t.apple_url is null
              and coalesce(t.release_status, 'unconfirmed') in ('unconfirmed', 'released')
              and not exists (select 1 from tracks v where v.parent_track_id = t.id)
              and not exists (select 1 from track_ownership o where o.track_id = t.id)
              and not exists (select 1 from ratings r where r.track_id = t.id)
              and not exists (select 1 from comments c where c.track_id = t.id)) shell,
             (t.spotify_url is not null)::int + (t.isrc is not null)::int + (t.length_sec is not null)::int
               + (t.album is not null)::int + (t.producers is not null)::int fullness
      from dup d join tracks t on t.id = d.track_id
    )
    select keep, ids from (
      -- Same Spotify link, or same ISRC, on every copy.
      select null::text keep, array_agg(id) ids from t
      group by artist_id, key
      having (count(distinct spotify_url) = 1 and count(spotify_url) = count(*))
          or (count(distinct isrc) = 1 and count(isrc) = count(*))
      union all
      -- Same album, same length, nothing clashing.
      select null, array_agg(id) from t
      where coalesce(ak, '') <> '' and length_sec is not null
      group by artist_id, key, ak
      having count(*) > 1 and max(length_sec) - min(length_sec) <= 2
         and count(distinct spotify_url) <= 1 and count(distinct isrc) <= 1
      union all
      -- Deluxe / remaster copies of the same album track.
      select null, array_agg(id) from t
      where not generic and ab is not null
      group by artist_id, key, ab
      having count(*) > 1 and coalesce(max(length_sec) - min(length_sec), 0) <= 2 and count(distinct isrc) <= 1
      union all
      -- Empty copies, into the fullest copy of the same title.
      select (select r.id from t r where r.artist_id = s.artist_id and r.key = s.key and not r.shell
              order by r.fullness desc, r.created_at nulls last, r.id limit 1),
             array_agg(s.id)
      from t s
      where s.shell and not s.generic
        and exists (select 1 from t r where r.artist_id = s.artist_id and r.key = s.key and not r.shell)
      group by s.artist_id, s.key
    ) z
    limit greatest(1, least(coalesce(p_limit, 200), 2000))
  loop
    if g.keep is not null and exists (select 1 from tracks where id = g.keep) then
      v_keep := g.keep;
    else
      select t.id into v_keep from tracks t
      where t.id = any (g.ids)
      order by (select count(*) from track_ownership o where o.track_id = t.id)
             + (select count(*) from ratings r where r.track_id = t.id)
             + (select count(*) from tracks v where v.parent_track_id = t.id)
             + (select count(*) from comments c where c.track_id = t.id) desc,
               t.created_at nulls last, t.id
      limit 1;
    end if;
    -- A group can overlap one merged earlier in this run.
    v_rest := array(select i from unnest(g.ids) i where i <> v_keep and exists (select 1 from tracks where id = i));
    continue when v_keep is null or cardinality(v_rest) = 0;
    perform set_config('static_cuts.batch_id', '', true);
    perform admin_merge_duplicates(v_keep, v_rest);
    n := n + cardinality(v_rest);
  end loop;
  perform set_config('static_cuts.batch_id', '', true);
  perform set_config('static_cuts.system_job', '', true);
  return n;
end $function$;
revoke execute on function sc_duplicate_auto_merge(int) from public, anon, authenticated;

-- ---------- 2. Download-site tags in titles ----------
create or replace function sc_title_tag_cleanup()
returns int language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  perform set_config('static_cuts.system_job', 'title-cleanup', true);
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('cleanup', 'Took download-site tags out of song titles');
  update tracks t set
    title = c.clean,
    aliases = nullif(trim(both ', ' from coalesce(t.aliases, '') || ', ' || t.title), '')
  from (
    select id, btrim(regexp_replace(title, '\s*[-–]?\s*[\(\[]?\s*(https?://|www\.)[^\s\)\]]+\s*[\)\]]?\s*', ' ', 'gi')) clean
    from tracks where title ~* '(https?://|www\.)[a-z0-9-]+\.[a-z]'
  ) c
  where t.id = c.id and length(c.clean) >= 1 and c.clean <> t.title;
  get diagnostics n = row_count;
  perform set_config('static_cuts.batch_id', '', true);
  perform set_config('static_cuts.system_job', '', true);
  return n;
end $function$;
revoke execute on function sc_title_tag_cleanup() from public, anon, authenticated;

-- ---------- 3. Clean-up review list ----------
create table if not exists cleanup_kept (
  track_id text primary key references tracks(id) on delete cascade,
  kept_by uuid,
  kept_at timestamptz not null default now()
);
alter table cleanup_kept enable row level security;

create or replace function sc_cleanup_kind(p_title text)
returns text language sql immutable parallel safe as $$
  select case
    when p_title ~* '\m(interview|podcast|livestream|live stream|instagram live|ig live|q ?& ?a|documentary|trailer|behind the scenes|vlog|reaction|unboxing|press conference|radio show)\M'
      or p_title ~* '\m(full (album|tape|ep|mixtape|project|leak)|tracklist|track list|cover art|album art|playlist|snippet compilation|all snippets|snippets compilation)\M'
      then 'not_song'
    when p_title ~* '^\s*(unknown|untitled|\?+|tba|tbd|n/?a|none|null|-+)\s*(song|track)?s?\s*[#\d\s]*$'
      or p_title ~* '^\s*(two |three |\d+ )?unknown songs?\M'
      or p_title !~ '[[:alnum:]]'
      then 'placeholder'
  end
$$;

create or replace function admin_cleanup_list(p_kind text default null, p_limit int default 300)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  return (
    with c as (
      select t.id, t.title, t.artist_id, a.name artist, t.release_status status, t.source, t.album, t.spotify_url,
             sc_cleanup_kind(t.title) kind,
             (select count(*) from tracks v where v.parent_track_id = t.id) versions,
             (select count(*) from track_ownership o where o.track_id = t.id) collected,
             t.created_at
      from tracks t join artists a on a.id = t.artist_id
      where t.parent_track_id is null
        and sc_cleanup_kind(t.title) is not null
        and not exists (select 1 from cleanup_kept k where k.track_id = t.id)
    ),
    -- Placeholders only when nothing is on them (an "Untitled" leak with a
    -- link, versions or collectors is a real song).
    f as (
      select * from c
      where kind = 'not_song'
         or (kind = 'placeholder' and versions = 0 and collected = 0 and spotify_url is null and album is null)
    )
    select jsonb_build_object(
      'counts', jsonb_build_object(
        'not_song', (select count(*) from f where kind = 'not_song'),
        'placeholder', (select count(*) from f where kind = 'placeholder')),
      'items', (select coalesce(jsonb_agg(to_jsonb(x) - 'spotify_url'), '[]'::jsonb) from (
        select * from f where p_kind is null or kind = p_kind
        order by artist, title limit greatest(1, least(coalesce(p_limit, 300), 1000))) x))
  );
end $function$;
revoke execute on function admin_cleanup_list(text, int) from public, anon;
grant execute on function admin_cleanup_list(text, int) to authenticated;

create or replace function admin_cleanup_action(p_ids text[], p_action text)
returns int language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_action = 'keep' then
    insert into cleanup_kept (track_id, kept_by) select unnest(p_ids), auth.uid() on conflict do nothing;
    get diagnostics n = row_count;
    return n;
  elsif p_action = 'delete' then
    perform sc_begin_batch('cleanup', 'Clean-up: removed ' || cardinality(p_ids) || ' entries that weren''t songs');
    delete from tracks where id = any (p_ids) and parent_track_id is null;
    get diagnostics n = row_count;
    return n;
  end if;
  raise exception 'unknown action';
end $function$;
revoke execute on function admin_cleanup_action(text[], text) from public, anon;
grant execute on function admin_cleanup_action(text[], text) to authenticated;

select cron.schedule('title-cleanup', '39 * * * *', $$ select public.sc_title_tag_cleanup(); $$);
