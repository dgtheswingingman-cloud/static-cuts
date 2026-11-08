-- Same song filed twice (or more) on one artist's page, where it's beyond
-- doubt: the same title AND either every copy has the same Spotify track
-- link, or every copy has the same ISRC, or every copy is on the same album
-- with the same length (within 2 s) and no copies disagree on Spotify or ISRC. Merged hourly into the copy with the most
-- history (collections, ratings, versions, comments), oldest first on a tie.
-- Everything less certain stays on /review/duplicates for a person.
create or replace function sc_duplicate_auto_merge(p_limit int default 200)
returns int language plpgsql security definer set search_path to 'public' as $function$
declare g record; v_keep text; v_rest text[]; n int := 0;
begin
  -- The same pass the hourly version clean-up uses to merge.
  perform set_config('static_cuts.system_job', 'version-auto-clear', true);
  for g in
    -- Same title on one page, from the precomputed title keys (fast).
    with dup as (
      select k.artist_id, k.key, k.track_id from track_title_keys k
      where k.is_main and k.key <> ''
        and (k.artist_id, k.key) in (select artist_id, key from track_title_keys where is_main and key <> ''
                                      group by 1, 2 having count(*) > 1)
    ),
    t as (
      select d.artist_id, d.key, t.id, t.spotify_url, t.isrc, t.length_sec,
             case when t.album is not null then sc_title_key(t.album) end ak
      from dup d join tracks t on t.id = d.track_id
    )
    select ids from (
      select array_agg(id) ids from t
      group by artist_id, key
      having (count(distinct spotify_url) = 1 and count(spotify_url) = count(*))
          or (count(distinct isrc) = 1 and count(isrc) = count(*))
      union all
      select array_agg(id) from t
      where coalesce(ak, '') <> '' and length_sec is not null
      group by artist_id, key, ak
      having count(*) > 1 and max(length_sec) - min(length_sec) <= 2
         and count(distinct spotify_url) <= 1 and count(distinct isrc) <= 1
    ) z
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    select t.id into v_keep from tracks t
    where t.id = any (g.ids)
    order by (select count(*) from track_ownership o where o.track_id = t.id)
           + (select count(*) from ratings r where r.track_id = t.id)
           + (select count(*) from tracks v where v.parent_track_id = t.id)
           + (select count(*) from comments c where c.track_id = t.id) desc,
             t.created_at nulls last, t.id
    limit 1;
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

select cron.schedule('duplicate-auto-merge', '41 * * * *', $$ select public.sc_duplicate_auto_merge(); $$);
