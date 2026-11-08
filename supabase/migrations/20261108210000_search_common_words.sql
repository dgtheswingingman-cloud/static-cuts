-- Searches matching a huge number of songs ("the" 119K, "a" 421K) took 3-5 s
-- because every match was ranked before the first 50 were returned. Now, when
-- a search would match more than 2,000 songs (or is only 1-2 letters long),
-- it ranks a short list of the likeliest matches instead: titles starting
-- with the search, songs by artists whose name starts with it, and a sample
-- of other matches. 'capped' tells the page the total is "this many or more".
create index if not exists tracks_title_lower_prefix_idx on tracks (lower(title) text_pattern_ops);
create index if not exists artists_name_lower_prefix_idx on artists (lower(name) text_pattern_ops);

create or replace function rpc_search_songs(p_q text default '', p_statuses text[] default null, p_year_from int default null,
  p_year_to int default null, p_has_link boolean default null, p_versions boolean default true, p_sort text default 'best',
  p_offset int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_q text := lower(trim(coalesce(p_q, '')));
  v_word text;
  v_like text;
  v_prefix text;
  v_n int;
begin
  if v_q = '' then
    return rpc_search_songs_scan(p_q, p_statuses, p_year_from, p_year_to, p_has_link, p_versions, p_sort, p_offset);
  end if;
  select w into v_word from unnest(regexp_split_to_array(v_q, '\s+')) w
  where length(w) >= 3 order by length(w) desc limit 1;
  v_prefix := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if v_word is not null then
    v_like := '%' || replace(replace(replace(v_word, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    select count(*) into v_n from (
      select 1 from tracks t where sc_search_text(t.title, t.aliases, t.album, t.producers) like v_like limit 2001
    ) x;
  end if;

  -- Big or very short searches: rank the likeliest matches only.
  if v_word is null or v_n > 2000 then
    return (
    with cand as (
      (select t.id from tracks t where lower(t.title) like v_prefix order by length(t.title), t.id limit 1500)
      union
      (select t.id from tracks t
       where t.artist_id in (select a.id from artists a where lower(a.name) like v_prefix order by length(a.name) limit 10)
       limit 1500)
      union
      (select t.id from tracks t
       where v_like is not null and sc_search_text(t.title, t.aliases, t.album, t.producers) like v_like
       limit 1500)
    ),
    q as (
      select v_q q, array_remove(regexp_split_to_array(v_q, '\s+'), '') w
    ),
    base as (
      select t.id, t.title, t.artist_id, a.name artist, t.spotify_url, t.album, t.release_date, t.created_at,
             t.parent_track_id, t.aliases, t.producers,
             coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) status,
             lower(t.title) ltitle
      from tracks t join artists a on a.id = t.artist_id
      where t.id in (select id from cand)
        and (p_statuses is null or coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) = any (p_statuses))
        and (p_year_from is null or extract(year from t.release_date) >= p_year_from)
        and (p_year_to is null or extract(year from t.release_date) <= p_year_to)
        and (p_has_link is null or (t.spotify_url is not null) = p_has_link)
        and (coalesce(p_versions, true) or t.parent_track_id is null)
    ),
    hits as (
      select b.* from base b, q
      where not exists (
        select 1 from unnest(q.w) x
        where position(x in lower(b.title || ' ' || coalesce(b.aliases, '') || ' ' || coalesce(b.album, '')
                                  || ' ' || coalesce(b.producers, '') || ' ' || b.artist)) = 0)
    )
    select jsonb_build_object(
      'total', (select count(*) from hits),
      'capped', true,
      'fuzzy', false,
      'items', (select coalesce(jsonb_agg(to_jsonb(x) - 'ltitle' - 'aliases' - 'producers'), '[]'::jsonb) from (
        select h.* from hits h, q
        order by
          case when p_sort = 'best' then case when h.ltitle = q.q then 0
                                              when lower(h.artist) = q.q then 1
                                              when h.ltitle like q.q || '%' then 2
                                              when position(q.q in h.ltitle) > 0 then 3 else 4 end end,
          case when p_sort = 'new' then h.created_at end desc nulls last,
          case when p_sort = 'released' then h.release_date end desc nulls last,
          h.parent_track_id is not null, length(h.ltitle), h.ltitle, h.artist
        offset greatest(coalesce(p_offset, 0), 0) limit 50) x))
    );
  end if;

  return (
  with cand as (
    select t.id from tracks t
    where sc_search_text(t.title, t.aliases, t.album, t.producers) like v_like
    union
    select t.id from tracks t where t.artist_id in (select a.id from artists a where lower(a.name) like v_like)
  ),
  q as (
    select v_q q, array_remove(regexp_split_to_array(v_q, '\s+'), '') w
  ),
  base as (
    select t.id, t.title, t.artist_id, a.name artist, t.spotify_url, t.album, t.release_date, t.created_at,
           t.parent_track_id, t.aliases, t.producers,
           coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) status,
           lower(t.title) ltitle
    from tracks t join artists a on a.id = t.artist_id
    where t.id in (select id from cand)
      and (p_statuses is null or coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) = any (p_statuses))
      and (p_year_from is null or extract(year from t.release_date) >= p_year_from)
      and (p_year_to is null or extract(year from t.release_date) <= p_year_to)
      and (p_has_link is null or (t.spotify_url is not null) = p_has_link)
      and (coalesce(p_versions, true) or t.parent_track_id is null)
  ),
  exact as (
    select b.*, 0::real sim from base b, q
    where cardinality(q.w) = 0 or not exists (
      select 1 from unnest(q.w) x
      where position(x in lower(b.title || ' ' || coalesce(b.aliases, '') || ' ' || coalesce(b.album, '')
                                || ' ' || coalesce(b.producers, '') || ' ' || b.artist)) = 0)
  ),
  fuzzy as (
    select t.id, t.title, t.artist_id, a.name artist, t.spotify_url, t.album, t.release_date, t.created_at,
           t.parent_track_id, t.aliases, t.producers,
           coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) status,
           lower(t.title) ltitle, extensions.word_similarity(q.q, lower(t.title)) sim
    from tracks t join artists a on a.id = t.artist_id, q
    where not exists (select 1 from exact) and length(q.q) >= 3
      and q.q operator(extensions.<%) lower(t.title)
      and (p_statuses is null or coalesce(t.release_status, case when t.is_official then 'released' else 'unconfirmed' end) = any (p_statuses))
      and (p_year_from is null or extract(year from t.release_date) >= p_year_from)
      and (p_year_to is null or extract(year from t.release_date) <= p_year_to)
      and (p_has_link is null or (t.spotify_url is not null) = p_has_link)
      and (coalesce(p_versions, true) or t.parent_track_id is null)
  ),
  hits as (select * from exact union all select * from fuzzy)
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'fuzzy', not exists (select 1 from exact) and exists (select 1 from fuzzy),
    'items', (select coalesce(jsonb_agg(to_jsonb(x) - 'ltitle' - 'aliases' - 'producers' - 'sim'), '[]'::jsonb) from (
      select h.* from hits h, q
      order by
        h.sim desc,
        case when p_sort = 'best' then case when h.ltitle = q.q then 0
                                            when h.ltitle like q.q || '%' then 1
                                            when position(q.q in h.ltitle) > 0 then 2 else 3 end end,
        case when p_sort = 'new' then h.created_at end desc nulls last,
        case when p_sort = 'released' then h.release_date end desc nulls last,
        h.parent_track_id is not null, h.ltitle, h.artist
      offset greatest(coalesce(p_offset, 0), 0) limit 50) x))
  );
end;
$fn$;
grant execute on function rpc_search_songs(text, text[], int, int, boolean, boolean, text, int) to anon, authenticated;
