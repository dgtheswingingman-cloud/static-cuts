-- Site-wide song search (/search).
--
--   p_q         words to find in the title, aliases, album or producers
--               (all words must match; can be empty when filtering)
--   p_statuses  only these statuses (null = any)
--   p_year_from / p_year_to   release year range
--   p_has_link  true = only songs with a listen link, false = only without
--   p_versions  include versions (remixes, alt takes...) as well as main songs
--   p_sort      'best' (title matches first), 'new' (recently added),
--               'released' (newest release date), 'az'
-- Returns {total, items: [...50]}.

create or replace function rpc_search_songs(
  p_q text default '', p_statuses text[] default null, p_year_from int default null, p_year_to int default null,
  p_has_link boolean default null, p_versions boolean default true, p_sort text default 'best', p_offset int default 0)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with words as (
    select array_remove(regexp_split_to_array(lower(trim(coalesce(p_q, ''))), '\s+'), '') w
  ),
  hits as (
    select t.id, t.title, t.artist_id, a.name artist, t.spotify_url, t.album, t.release_date, t.created_at,
           t.parent_track_id,
           coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) status,
           lower(t.title) ltitle
    from tracks t join artists a on a.id = t.artist_id, words
    where (cardinality(words.w) = 0 or not exists (
             select 1 from unnest(words.w) x
             where position(x in lower(t.title || ' ' || coalesce(t.aliases, '') || ' ' || coalesce(t.album, '')
                                       || ' ' || coalesce(t.producers, ''))) = 0))
      and (p_statuses is null or coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) = any (p_statuses))
      and (p_year_from is null or extract(year from t.release_date) >= p_year_from)
      and (p_year_to is null or extract(year from t.release_date) <= p_year_to)
      and (p_has_link is null or (t.spotify_url is not null) = p_has_link)
      and (coalesce(p_versions, true) or t.parent_track_id is null)
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'items', (select coalesce(jsonb_agg(to_jsonb(x) - 'ltitle'), '[]'::jsonb) from (
      select h.* from hits h
      order by
        case when p_sort = 'best' then case when h.ltitle = lower(trim(coalesce(p_q, ''))) then 0
                                            when h.ltitle like lower(trim(coalesce(p_q, ''))) || '%' then 1
                                            when position(lower(trim(coalesce(p_q, ''))) in h.ltitle) > 0 then 2 else 3 end end,
        case when p_sort = 'new' then h.created_at end desc nulls last,
        case when p_sort = 'released' then h.release_date end desc nulls last,
        h.parent_track_id is not null, h.ltitle, h.artist
      offset greatest(coalesce(p_offset, 0), 0) limit 50) x));
$$;

revoke execute on function rpc_search_songs(text, text[], int, int, boolean, boolean, text, int) from public;
grant execute on function rpc_search_songs(text, text[], int, int, boolean, boolean, text, int) to anon, authenticated;
