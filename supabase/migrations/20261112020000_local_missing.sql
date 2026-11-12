-- Local Cuts "What am I missing": given the songs someone's files matched,
-- for each artist they have 3+ songs of: how many of that artist's songs
-- they have (released, leaked and snippets; not rumours, teasers or
-- unconfirmed imports), split by era (the album / era name), and which ones
-- are missing. Versions count as their main song. Premium sees the lists.
create or replace function public.rpc_local_missing(p_track_ids text[])
returns jsonb language plpgsql stable security definer set search_path to 'public' set statement_timeout to '20s' as $$
declare full_list boolean := is_premium(auth.uid());
begin
  if p_track_ids is null or cardinality(p_track_ids) = 0 then return '[]'; end if;
  return coalesce((
    with mine as (
      select distinct coalesce(t.parent_track_id, t.id) id from tracks t where t.id = any (p_track_ids[1:20000])
    ),
    who as (
      select t.artist_id, count(*) n from mine m join tracks t on t.id = m.id group by 1 having count(*) >= 3
      order by 2 desc limit 40
    ),
    songs as (
      select t.id, t.title, t.artist_id, t.release_status status, nullif(trim(t.album), '') era,
             coalesce(t.release_date, t.leak_date) as d, exists (select 1 from mine m where m.id = t.id) as got
      from tracks t join who w on w.artist_id = t.artist_id
      where t.parent_track_id is null and t.release_status in ('released', 'leaked', 'snippet')
    ),
    eras as (
      select artist_id, coalesce(era, 'Singles & loose songs') era, count(*) total, count(*) filter (where got) got, min(d) first_day
      from songs group by 1, 2
    )
    select jsonb_agg(jsonb_build_object(
      'artist_id', a.id, 'artist', a.name, 'photo', a.image_url,
      'have', (select count(*) from songs s where s.artist_id = a.id and s.got),
      'total', (select count(*) from songs s where s.artist_id = a.id),
      'eras', (select coalesce(jsonb_agg(jsonb_build_object('era', e.era, 'have', e.got, 'total', e.total) order by e.first_day nulls last, e.era), '[]')
               from eras e where e.artist_id = a.id),
      'missing', case when full_list then (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'status', s.status,
                       'era', coalesce(s.era, 'Singles & loose songs'), 'day', s.d) order by s.d nulls last, s.title), '[]')
                 from (select * from songs s where s.artist_id = a.id and not s.got order by s.d nulls last, s.title limit 400) s) end
    ) order by w.n desc)
    from who w join artists a on a.id = w.artist_id), '[]');
end $$;
revoke execute on function public.rpc_local_missing(text[]) from public;
grant execute on function public.rpc_local_missing(text[]) to authenticated;
