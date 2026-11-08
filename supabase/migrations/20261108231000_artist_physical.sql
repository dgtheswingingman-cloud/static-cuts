-- Artist page: "Physical releases" from Discogs: albums pressed on vinyl,
-- CD or tape, plus physical singles, linking to the album page where it exists.
create or replace function rpc_artist_physical(p_artist text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(x order by x.year desc nulls last, x.title), '[]'::jsonb) from (
    select d.discogs_id id, d.kind, d.title, d.year,
           case when d.kind = 'master' then coalesce(d.formats, '{}') else array[btrim(split_part(d.format, ',', 1))] end formats, d.versions,
           'https://www.discogs.com/' || case when d.kind = 'master' then 'master/' else 'release/' end || d.discogs_id url,
           al.album_id, al.cover
    from discogs_releases d
    left join lateral (
      select a.album_id, a.cover from deezer_albums a
      where a.artist_id = d.artist_id and sc_title_key(a.title) = sc_title_key(d.title) and coalesce(a.review, '') <> 'remove'
      order by a.songs desc nulls last limit 1
    ) al on true
    where d.artist_id = p_artist
      and ((d.kind = 'master' and cardinality(d.formats) > 0)
        or (d.kind = 'release' and d.format ~* '(vinyl|cassette|\mcd\M|lp\M|7"|12")'))
  ) x
$$;
grant execute on function rpc_artist_physical(text) to anon, authenticated;
