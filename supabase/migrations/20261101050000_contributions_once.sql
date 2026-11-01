-- Profile pages: someone's contributions list worked out their whole
-- history three times (totals, count, recent), 5-6 s for an active
-- contributor, over the 3 s limit for people who aren't logged in. Now it's
-- worked out once and reused (~0.25 s, same result).

create or replace function rpc_user_contributions(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '32MB'
as $$
declare
  v jsonb;
begin
  if not sc_contributions_visible(p_user) then
    return jsonb_build_object('visible', false);
  end if;
  with e as materialized (select * from sc_contribution_events(p_user))
  select jsonb_build_object(
    'visible', true,
    'totals', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from e group by kind) x),
    'total', (select count(*) from e),
    'recent', (select coalesce(jsonb_agg(to_jsonb(r) order by r.at desc), '[]'::jsonb) from (
                 select e.kind, e.at, e.track_id, e.title, e.artist_id, a.name as artist_name
                 from e left join artists a on a.id = e.artist_id
                 order by e.at desc limit 30) r)
  ) into v;
  return v;
end;
$$;
