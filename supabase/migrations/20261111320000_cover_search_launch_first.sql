-- cover-search: the launch artists' songs go first (covers, and unconfirmed
-- songs Deezer has becoming released), then everyone else as before.
-- Unconfirmed songs that already have a cover are searched too, so they can
-- still be confirmed as released.
create or replace function public.sc_cover_search_next(p_secret text, p_limit int default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(x) from (
    select t.id, t.title, a.name artist, t.deezer_url, t.apple_url, t.release_status, t.length_sec from tracks t join artists a on a.id = t.artist_id
    where t.parent_track_id is null and t.release_status in ('released', 'unconfirmed')
      and (t.cover_url is null or t.release_status = 'unconfirmed')
      and not exists (select 1 from cover_search_checked c where c.track_id = t.id and c.checked_at > now() - interval '90 days')
    order by (t.artist_id = any (array['playboi-carti','ken-carson','destroy-lonely','hxg','bladee','ecco2k','thaiboy-digital','zillakami','sosmula','city-morgue'])) desc,
      (t.release_status = 'released') desc, (t.deezer_url is not null or t.apple_url is not null) desc,
      (select count(*) from follows f where f.artist_id = t.artist_id) desc, t.id
    limit greatest(1, least(p_limit, 60))) x), '[]');
end $$;
revoke execute on function public.sc_cover_search_next(text, int) from anon, authenticated, public;
