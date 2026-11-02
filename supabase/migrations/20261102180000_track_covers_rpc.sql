-- Local Cuts: the picture each song shows on the site (own art, else fans'
-- pick, else a photo of the artist), for up to 500 songs at once.
create or replace function rpc_track_covers(p_ids text[])
returns table (id text, url text, kind text)
language sql stable security definer set search_path to 'public' as $$
  select x.id, c ->> 'url', c ->> 'kind'
  from unnest(coalesce(p_ids, '{}')) with ordinality x(id, n), lateral sc_track_cover(x.id) c
  where x.n <= 500;
$$;
grant execute on function rpc_track_covers(text[]) to anon, authenticated;
