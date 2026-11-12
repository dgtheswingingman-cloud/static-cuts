-- "What you're missing" from your collection (Spotify, Exportify and file imports, and songs ticked by hand).
create or replace function public.rpc_collection_missing()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when auth.uid() is null then '[]'::jsonb
    else rpc_local_missing(array(select o.track_id from track_ownership o where o.user_id = auth.uid() limit 20000)) end;
$$;
revoke execute on function public.rpc_collection_missing() from public;
grant execute on function public.rpc_collection_missing() to authenticated;
