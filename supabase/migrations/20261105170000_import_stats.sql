-- Numbers for the top of the imported songs page.
create or replace function admin_import_stats()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when not is_admin() then null else jsonb_build_object(
    'waiting', count(*) filter (where state = 'open'),
    'added_today', count(*) filter (where state = 'applied' and decided_at >= date_trunc('day', now())),
    'dismissed_today', count(*) filter (where state = 'dismissed' and decided_at >= date_trunc('day', now())),
    'added_week', count(*) filter (where state = 'applied' and decided_at >= now() - interval '7 days'),
    'by_source', coalesce((select jsonb_object_agg(source, n) from (select source, count(*) n from import_suggestions where state = 'open' group by source) x), '{}'::jsonb)
  ) end
  from import_suggestions where state = 'open' or decided_at >= now() - interval '7 days';
$$;
revoke execute on function admin_import_stats() from public, anon;
grant execute on function admin_import_stats() to authenticated;
