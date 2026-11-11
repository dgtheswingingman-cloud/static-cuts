-- Monthly roundup: the month's top 3 contributors (picture and caption).
create or replace function public.sc_social_top_contributors(p_month date) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with m as (select (date_trunc('month', p_month)::date)::timestamp at time zone 'Europe/London' s,
                    ((date_trunc('month', p_month) + interval '1 month')::date)::timestamp at time zone 'Europe/London' e),
  ev as (select e.user_id from m, sc_contribution_events(null, m.s) e where e.at < m.e),
  c as (select ev.user_id, count(*) n from ev group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', coalesce(p.display_name, 'unnamed'), 'avatar', p.avatar_url, 'n', c.n) order by c.n desc), '[]')
  from (select c.* from c join profiles p on p.id = c.user_id
        where p.show_contributions and not exists (select 1 from moderators mo where mo.user_id = c.user_id)
          and not exists (select 1 from auth.users u where u.id = c.user_id and u.email = 'dg.theswingingman@gmail.com')
        order by c.n desc limit 3) c join profiles p on p.id = c.user_id;
$$;
revoke execute on function public.sc_social_top_contributors(date) from anon, authenticated, public;

do $d$
declare src text := pg_get_functiondef('public.sc_social_build(date)'::regprocedure); n text;
begin
  n := replace(src, 'r := sc_social_monthly((d - 1));', 'r := sc_social_monthly((d - 1)) || jsonb_build_object(''contributors'', sc_social_top_contributors(d - 1));');
  n := replace(n, $q$|| E'\n\nSwipe for the lot, link in bio.\n\n#'$q$,
    $q$|| coalesce(E'\n\nTop contributors: ' || (select string_agg(x ->> 'name', ', ') from jsonb_array_elements(r -> 'contributors') x) || '. Thank you!', '')
        || E'\n\nSwipe for the lot, link in bio.\n\n#'$q$);
  if n = src or position('Top contributors' in n) = 0 then raise exception 'no change'; end if;
  execute n;
end $d$;
