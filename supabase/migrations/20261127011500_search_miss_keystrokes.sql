-- 27 Nov: search runs as you type, so a miss was logged for every keystroke
-- ("strangers a", "strangers ag", ...). That buried real misses in the
-- control room, and since artist misses seen twice are queued for import
-- (sc_queue_searched_artists), fragments could get queued too. Now a new miss
-- replaces the shorter misses typed just before it (same kind, within two
-- minutes, seen once), and a miss that is the start of one just logged (the
-- person backspacing) isn't logged. Existing fragments like that are cleared
-- (log entries only; nothing in the catalogue).

create or replace function public.rpc_log_search_miss(p_query text, p_kind text default 'songs')
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  q text := lower(regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g'));
  qe text;
begin
  if length(q) < 3 or length(q) > 80 or p_kind not in ('songs', 'artists') then return; end if;
  qe := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  -- Backspacing: a longer query starting with this one was just logged.
  if exists (select 1 from search_misses m where m.kind = p_kind and m.last_at > now() - interval '2 minutes'
             and m.query <> q and m.query like qe || '%') then
    return;
  end if;
  -- Typing on: drop the shorter fragments logged just before.
  delete from search_misses m
  where m.kind = p_kind and m.times = 1 and m.last_at > now() - interval '2 minutes'
    and m.query <> q and q like replace(replace(replace(m.query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  insert into search_misses (query, kind) values (q, p_kind)
  on conflict (kind, query) do update set times = search_misses.times + 1, last_at = now();
end;
$function$;

delete from search_misses a
where a.times = 1
  and exists (select 1 from search_misses b
              where b.kind = a.kind and b.query <> a.query and length(b.query) > length(a.query)
                and b.query like replace(replace(replace(a.query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
                and abs(extract(epoch from (b.first_at - a.first_at))) < 120);
