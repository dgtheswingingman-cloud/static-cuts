-- A producer who's also an artist in the archive (Kanye West the producer is
-- Kanye West the rapper). Matched on the exact name or one of the artist's
-- aliases, never a guess. If two artists share the name, the one with more
-- songs wins.

create or replace function public.rpc_producer_artist(p_name text)
returns table(id text, name text, image_url text)
language sql stable security definer set search_path to 'public' as $$
  select a.id, a.name, a.image_url
  from artists a
  where lower(a.name) = lower(trim(p_name))
     or exists (select 1 from artist_aliases x where x.artist_id = a.id and lower(x.alias) = lower(trim(p_name)))
  order by (lower(a.name) = lower(trim(p_name))) desc,
           (select count(*) from tracks t where t.artist_id = a.id) desc
  limit 1;
$$;

-- Photos for a handful of producer names (for the top cards on /producers).
create or replace function public.rpc_producer_photos(p_names text[])
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_object_agg(n, r.image_url) filter (where r.image_url is not null), '{}'::jsonb)
  from unnest(p_names[1:50]) n
  cross join lateral (select image_url from rpc_producer_artist(n)) r;
$$;

-- The other way round: the producer credits an artist has under their own
-- name or an alias, so their artist page can link to it.
create or replace function public.rpc_artist_producer(p_artist_id text)
returns table(name text, songs bigint)
language sql stable security definer set search_path to 'public' as $$
  with names as (
    select lower(a.name) k from artists a where a.id = p_artist_id
    union select lower(x.alias) from artist_aliases x where x.artist_id = p_artist_id
  )
  select min(n), count(distinct t.id)
  from tracks t, sc_split_names(t.producers) n
  where t.producers is not null
    and exists (select 1 from names where strpos(lower(t.producers), names.k) > 0)
    and lower(n) in (select k from names)
  group by lower(n)
  order by count(distinct t.id) desc
  limit 1;
$$;

grant execute on function public.rpc_producer_artist(text), public.rpc_producer_photos(text[]), public.rpc_artist_producer(text) to anon, authenticated;
