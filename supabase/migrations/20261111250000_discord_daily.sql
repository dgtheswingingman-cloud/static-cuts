-- Discord: the site's daily posts in a server channel. /daily on posts song
-- of the day (and on this day, if asked), album of the week on Mondays and
-- the monthly roundup on the 1st, from 10am London time.

create table if not exists public.discord_daily_subs (
  channel_id text primary key,
  guild_id text not null,
  on_this_day boolean not null default false,
  active boolean not null default true,
  added_by text,
  created_at timestamptz not null default now()
);
create table if not exists public.discord_daily_sent (
  channel_id text not null,
  post_id uuid not null references public.social_posts(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (channel_id, post_id)
);
alter table public.discord_daily_subs enable row level security;
alter table public.discord_daily_sent enable row level security;

create or replace function public.sc_discord_daily(p_secret text, p_guild text, p_channel text, p_on boolean, p_otd boolean, p_user text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  if p_on then
    insert into discord_daily_subs (channel_id, guild_id, on_this_day, added_by) values (p_channel, p_guild, coalesce(p_otd, false), p_user)
    on conflict (channel_id) do update set active = true, on_this_day = coalesce(p_otd, discord_daily_subs.on_this_day), added_by = excluded.added_by;
    -- don't post today's (and older) posts the moment it's turned on after 10am: start with the next ones
    insert into discord_daily_sent (channel_id, post_id)
    select p_channel, id from social_posts where post_date < (now() at time zone 'Europe/London')::date on conflict do nothing;
  elsif p_on is false then
    update discord_daily_subs set active = false where channel_id = p_channel;
  end if;
  return coalesce((select jsonb_build_object('ok', true, 'active', active, 'on_this_day', on_this_day) from discord_daily_subs where channel_id = p_channel),
                  jsonb_build_object('ok', true, 'active', false));
end $$;

-- Posts due in channels: today's (made, from 10am), not sent there yet.
create or replace function public.sc_discord_daily_take(p_secret text, p_limit int default 40)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v jsonb; now_l timestamp := now() at time zone 'Europe/London';
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  if extract(hour from now_l) < 10 then return '[]'; end if;
  with due as (
    select s.channel_id, p.id post_id from discord_daily_subs s
    join social_posts p on p.post_date = now_l::date
      and (p.kind in ('song_of_day', 'album_of_week', 'monthly') or (p.kind = 'on_this_day' and s.on_this_day))
    where s.active and not exists (select 1 from discord_daily_sent d where d.channel_id = s.channel_id and d.post_id = p.id)
    order by s.channel_id, array_position(array['monthly', 'album_of_week', 'song_of_day', 'on_this_day'], p.kind)
    limit p_limit),
  ins as (insert into discord_daily_sent (channel_id, post_id) select channel_id, post_id from due on conflict do nothing returning channel_id, post_id)
  select coalesce(jsonb_agg(jsonb_build_object('channel_id', i.channel_id, 'post_id', p.id, 'kind', p.kind, 'post_date', p.post_date, 'ref', p.ref)), '[]')
  into v from ins i join social_posts p on p.id = i.post_id;
  return v;
end $$;

-- A channel the bot can't post in any more: stop.
create or replace function public.sc_discord_daily_off(p_secret text, p_channel text) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  update discord_daily_subs set active = false where channel_id = p_channel;
end $$;

revoke execute on function public.sc_discord_daily(text, text, text, boolean, boolean, text), public.sc_discord_daily_take(text, int),
  public.sc_discord_daily_off(text, text) from anon, authenticated, public;
grant execute on function public.sc_discord_daily(text, text, text, boolean, boolean, text), public.sc_discord_daily_take(text, int),
  public.sc_discord_daily_off(text, text) to service_role;

-- The 2-minute timer also runs when a daily post is due somewhere.
create or replace function public.sc_discord_daily_due() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select extract(hour from now() at time zone 'Europe/London') >= 10 and exists (
    select 1 from discord_daily_subs s join social_posts p on p.post_date = (now() at time zone 'Europe/London')::date
      and (p.kind in ('song_of_day', 'album_of_week', 'monthly') or (p.kind = 'on_this_day' and s.on_this_day))
    where s.active and not exists (select 1 from discord_daily_sent d where d.channel_id = s.channel_id and d.post_id = p.id));
$$;
revoke execute on function public.sc_discord_daily_due() from anon, authenticated, public;

select cron.schedule('discord-alerts', '*/2 * * * *', $c$
  select net.http_post(
    url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/run-job',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := jsonb_build_object('fn', 'discord', 'body', jsonb_build_object('mode', 'post')),
    timeout_milliseconds := 15000)
  where exists (select 1 from public.discord_alert_queue q where q.sent_at is null) or public.sc_discord_daily_due();
$c$);
