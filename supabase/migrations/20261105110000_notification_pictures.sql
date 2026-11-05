-- Notifications carry a picture and a status for the redesigned page: the
-- song cover (or the artist's photo) for song alerts, the person's profile
-- picture for follows and messages, and the first artist's photo for the
-- daily round-up. Status is the song's status now.

create or replace function public.rpc_my_notifications(p_limit integer default 50, p_admin boolean default false)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'unread', (select count(*) from notifications where user_id = auth.uid() and read_at is null and sc_notification_side(kind, p_admin)),
    'items', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]'::jsonb) from (
       select x.id, x.kind, x.title, x.body, x.link, x.created_at, x.read_at,
              coalesce(t.cover_url, ta.image_url, p.avatar_url, da.image_url) as image,
              (t.cover_url is null) as round,
              t.release_status as status
       from notifications x
       left join tracks t on t.id = x.track_id
       left join artists ta on ta.id = t.artist_id
       left join profiles p on x.kind in ('follow', 'message')
         and p.id::text = substring(x.link from '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
       left join lateral (
         select a.image_url from artists a
         where x.kind = 'digest'
           and lower(a.name) = lower(substring(x.title from '^Yesterday for (.+?)(?: and [0-9]+ more you follow)?$'))
         order by (a.image_url is not null) desc limit 1
       ) da on true
       where x.user_id = auth.uid() and sc_notification_side(x.kind, p_admin)
       order by x.created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) n));
$$;
