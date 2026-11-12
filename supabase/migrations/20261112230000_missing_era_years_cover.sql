-- Collection cards: each era in rpc_local_missing also gives its years
-- (from / to) and a cover (from one of its songs, one you have first) for
-- its thumbnail.
do $$
declare d text; o text;
begin
  o := pg_get_functiondef('rpc_local_missing(text[])'::regprocedure);
  if position('last_day' in o) > 0 then return; end if; -- already applied
  d := replace(o, $x$             coalesce(t.release_date, t.leak_date) as d, exists (select 1 from mine m where m.id = t.id) as got$x$,
                  $x$             coalesce(t.release_date, t.leak_date) as d, exists (select 1 from mine m where m.id = t.id) as got,
             coalesce(t.cover_url, t.fan_cover_url) as cover$x$);
  d := replace(d, $x$count(*) filter (where got) got, min(d) first_day$x$,
                  $x$count(*) filter (where got) got, min(d) first_day, max(d) last_day,
             (array_agg(cover order by got desc, d nulls last) filter (where cover is not null))[1] cover$x$);
  d := replace(d, $x$jsonb_build_object('era', e.era, 'have', e.got, 'total', e.total)$x$,
                  $x$jsonb_build_object('era', e.era, 'have', e.got, 'total', e.total,
                   'from', extract(year from e.first_day)::int, 'to', extract(year from e.last_day)::int, 'cover', e.cover)$x$);
  if position('last_day' in d) = 0 then raise exception 'patch did not apply'; end if;
  execute d;
end $$;
