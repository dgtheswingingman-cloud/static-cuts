-- How big an artist is: Deezer fan counts (11 Nov 2026), for the home
-- page's Featured mix (popular / underground / deep). Read once a month per
-- artist by the deezer-fans job (no key; takes 'deezer' tickets).
alter table artists add column if not exists deezer_fans int, add column if not exists deezer_fans_at timestamptz;

create or replace function sc_deezer_fans_next(p_secret text, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_secret is distinct from (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('artist_id', id, 'deezer_id', deezer_artist_id)), '[]'::jsonb) from (
    select id, deezer_artist_id from artists
    where deezer_artist_id is not null and (deezer_fans_at is null or deezer_fans_at < now() - interval '30 days')
    order by deezer_fans_at nulls first limit greatest(1, least(coalesce(p_limit, 100), 300))) x);
end $function$;
revoke execute on function sc_deezer_fans_next(text, int) from public, anon, authenticated;

create or replace function sc_deezer_fans_save(p_secret text, p_items jsonb)
returns int language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  if p_secret is distinct from (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  update artists a set deezer_fans = x.fans, deezer_fans_at = now()
  from jsonb_to_recordset(p_items) x(artist_id text, fans int) where a.id = x.artist_id;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke execute on function sc_deezer_fans_save(text, jsonb) from public, anon, authenticated;

select cron.schedule('deezer-fans', '7-59/10 * * * *', $$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := jsonb_build_object('fn', 'deezer-fans', 'body', '{}'::jsonb),
    timeout_milliseconds := 15000);
$$);
