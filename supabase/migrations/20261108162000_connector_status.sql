-- For /settings: is ChatGPT (or another connected app) still signed in?
create or replace function rpc_my_connector_status()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'connected', exists (select 1 from auth.sessions s where s.user_id = auth.uid() and s.oauth_client_id is not null
                         and (s.not_after is null or s.not_after > now())),
    'last_used', (select max(coalesce(s.refreshed_at, s.updated_at, s.created_at)) from auth.sessions s
                  where s.user_id = auth.uid() and s.oauth_client_id is not null)
  )
$$;
revoke execute on function rpc_my_connector_status() from public, anon;
grant execute on function rpc_my_connector_status() to authenticated;
