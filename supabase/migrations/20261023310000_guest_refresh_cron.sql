-- guest-artists still timed out overnight: its list call also tidied up the
-- guest list and moved songs to guests' new pages, which takes ~8 seconds
-- on its own (27,000 feature songs, 10,500 guests) — and the website's
-- database calls stop at 8. Each timeout undid the run, so the backlog of
-- songs to move never shrank.
-- Now the tidy-up runs as its own database timer (guest-refresh, a few
-- minutes before each guest-artists run), which isn't held to 8 seconds,
-- and the list call only reads.

-- The list call, read-only and quicker: the feature songs and artist weights
-- are read once (it took 5-13 seconds, now about 1.5).
create or replace function sc_guest_next(p_secret text, p_limit integer default 8)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_wait boolean := sc_existing_work_left();
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return jsonb_build_object(
    'known', (select coalesce(jsonb_object_agg(spotify_artist_id, id), '{}'::jsonb) from artists where spotify_artist_id is not null),
    'new_pages', not v_wait,
    'guests', (
      with picked as (
        select g.* from guest_artists g
        where g.state = 'pending' and g.songs > 0
          -- Waiting for new pages: each guest is looked at once a week (in
          -- case they turn out to be an artist already here).
          and (not v_wait or g.checked_at is null or g.checked_at < now() - interval '7 days')
      ), feat as materialized (
        select lower(sc_guest_name(t.notes)) k, t.title, t.artist_id, t.id from tracks t
        where t.notes like 'Feature on %'
      ), wts as materialized (select * from sc_artist_weights()),
      hosts as (
        -- How much the artists they feature with matter (the shared order).
        select f.k, max(w.weight) wt from feat f join wts w on w.artist_id = f.artist_id group by f.k
      ), top as (
        select p.* from picked p left join hosts h on h.k = p.name_key
        order by coalesce(h.wt, 0) desc, p.songs desc, p.name
        limit greatest(1, least(coalesce(p_limit, 8), 20))
      ), titles as (
        select f.k, f.title, row_number() over (partition by f.k order by f.id) rn
        from feat f where f.k in (select name_key from top)
      )
      select coalesce(jsonb_agg(jsonb_build_object('key', p.name_key, 'name', p.name,
               'titles', (select jsonb_agg(ti.title) from titles ti where ti.k = p.name_key and ti.rn <= 3))), '[]'::jsonb)
      from top p));
end;
$fn$;
revoke execute on function sc_guest_next(text, integer) from public, anon, authenticated;
grant execute on function sc_guest_next(text, integer) to service_role;

-- Up to 40 guests' songs moved per run.
do $$
declare
  d text := pg_get_functiondef('public.sc_guest_refresh()'::regprocedure);
begin
  if position('order by songs desc limit 8' in d) > 0 then
    execute replace(d, 'order by songs desc limit 8', 'order by songs desc limit 40');
  end if;
end $$;

select cron.schedule('guest-refresh', '4-59/20 * * * *', 'select public.sc_guest_refresh()');
