-- 27 Nov: the weekly NIX summary also says how the main artists' pages moved
-- (the progress cards: status, links, leak dates, eras, with the change since
-- the snapshot about a week ago) and what ChatGPT did through the connector
-- (research runs, finds sent for review, second opinions on NIX, calls).

do $$
declare d text := pg_get_functiondef('public.sc_nix_weekly_build(boolean)'::regprocedure);
begin
  d := replace(d, 'usd_week numeric; usd_month numeric; cap numeric; failing text; by_kind text;',
                  'usd_week numeric; usd_month numeric; cap numeric; failing text; by_kind text; prog text; gpt text;');
  d := replace(d, $p$  lines := array[
    format('The PC answered$p$,
$p$  with p as (
    select x.artist_id, x.data n,
      (select dd.data from launch_progress_days dd where dd.artist_id = x.artist_id and dd.day between current_date - 8 and current_date - 6
       order by dd.day limit 1) o
    from sc_launch_progress_now() x),
  k(ord, lbl, num, den) as (values (1, 'status', 'status', 'songs'), (2, 'links', 'link', 'link_of'),
                                   (3, 'leak dates', 'date', 'date_of'), (4, 'eras', 'era', 'era_of')),
  s as (select k.ord, k.lbl, sum((p.n ->> k.num)::int) a, sum((p.n ->> k.den)::int) b,
               sum((p.o ->> k.num)::int) c, sum((p.o ->> k.den)::int) dn, count(p.o) has_old
        from k cross join p group by k.ord, k.lbl)
  select string_agg(lbl || ' ' || round(100.0 * a / nullif(b, 0)) || '%'
           || case when coalesce(dn, 0) > 0 and has_old > 0
                   then ' (' || to_char(round(100.0 * a / nullif(b, 0)) - round(100.0 * c / dn), 'SG990') || ')' else '' end,
           ', ' order by ord)
  into prog from s;

  select case when runs + finds + opinions + calls > 0 then
    format('ChatGPT: %s research runs, %s finds sent for review, %s second opinions on NIX, %s connector calls (%s failed).',
           runs, finds, opinions, calls, failed) end
  into gpt from (
    select (select count(*) from routine_runs where started_at > since and client_id is not null) runs,
           (select coalesce(sum(submitted), 0) from routine_runs where started_at > since and client_id is not null) finds,
           (select count(*) from nix_second_opinions where created_at > since) opinions,
           (select count(*) from mcp_calls where at > since) calls,
           (select count(*) from mcp_calls where at > since and not ok) failed) z;

  lines := array[
    format('The PC answered$p$);
  d := replace(d, $p$    format('Waiting for you: %s suggestions$p$,
$p$    case when prog is not null then 'Main artists'' pages: ' || prog || '.' end,
    gpt,
    format('Waiting for you: %s suggestions$p$);
  if position('prog text; gpt text;' in d) = 0 or position('prog is not null' in d) = 0 or position('into prog from s' in d) = 0 then
    raise exception 'patch missed: weekly';
  end if;
  execute d;
end $$;
