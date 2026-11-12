-- Premium perks (12 Nov 2026):
-- 1. Founding supporters: the first 100 people to pay for Premium get a
--    numbered founder badge, kept for good (even if Premium ends later).
-- 2. Contributors earn Premium: on the 1st, last month's top 3 contributors
--    (the same three as the monthly roundup) get a free month. People
--    without a subscription get a month added to their Premium; people who
--    already pay get a month's credit on Stripe instead (the billing
--    function's "rewards" action). Each gets a notification.

-- ---------- 1. Founding supporters ----------
create table if not exists premium_founders (
  user_id uuid primary key references auth.users(id) on delete cascade,
  number int not null unique check (number between 1 and 100),
  joined_at timestamptz not null default now()
);
alter table premium_founders enable row level security;

create or replace function sc_founder_claim(p_user uuid) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  select number into n from premium_founders where user_id = p_user;
  if n is not null then return n; end if;
  if exists (select 1 from auth.users u where u.id = p_user and u.email = 'dg.theswingingman@gmail.com') then return null; end if;
  perform pg_advisory_xact_lock(hashtext('premium_founders'));
  select coalesce(max(number), 0) + 1 into n from premium_founders;
  if n > 100 then return null; end if;
  insert into premium_founders (user_id, number) values (p_user, n);
  insert into notifications (user_id, kind, title, body, link, dedupe_key)
  values (p_user, 'reward', 'You''re founding supporter #' || n,
    'One of the first 100 to back Static-Cuts//. The founder badge is yours for good. Thank you!', '/premium', 'founder')
  on conflict do nothing;
  return n;
end $$;
revoke execute on function sc_founder_claim(uuid) from public, anon, authenticated;

-- A paid subscription (active) claims a founder spot.
do $d$
declare src text := pg_get_functiondef('public.sc_stripe_subscription_save(text, text, text, timestamptz)'::regprocedure); n text;
begin
  if position('sc_founder_claim' in src) > 0 then return; end if;
  n := replace(src, $q$  select * into m from premium_members where user_id = u;$q$,
    $q$  if p_status in ('active', 'trialing') then perform sc_founder_claim(u); end if;
  select * into m from premium_members where user_id = u;$q$);
  if n = src then raise exception 'sc_stripe_subscription_save not patched'; end if;
  execute n;
end $d$;

-- For /premium: how many founder spots are left.
create or replace function rpc_founders_left() returns int
language sql stable security definer set search_path to 'public' as $$
  select greatest(0, 100 - (select count(*) from premium_founders))::int;
$$;
grant execute on function rpc_founders_left() to anon, authenticated;

-- Badges: founder number (kept even when Premium has ended).
create or replace function public.rpc_user_badges(p_ids uuid[])
 returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_object_agg(p.id, jsonb_build_object(
    'supporter', is_premium(p.id),
    'founder', (select f.number from premium_founders f where f.user_id = p.id),
    'fans', coalesce((select jsonb_agg(jsonb_build_object('artist_id', a.id, 'name', a.name, 'tag', coalesce(nullif(a.tag, ''), sc_artist_tag(a.name))) order by x.n)
       from unnest(p.fan_artists) with ordinality x(id, n) join artists a on a.id = x.id
       where x.n <= case when is_premium(p.id) then 3 else 1 end), '[]'::jsonb))), '{}'::jsonb)
  from profiles p where p.id = any (coalesce(p_ids, '{}'));
$function$;

-- ---------- 2. Contributors earn Premium ----------
create table if not exists contributor_rewards (
  month date not null,                 -- the month they contributed in (1st of it)
  user_id uuid not null references auth.users(id) on delete cascade,
  rank int not null,
  kind text not null check (kind in ('free_month', 'stripe_credit', 'has_premium')),
  given_at timestamptz,                -- null: Stripe credit still to send
  primary key (month, user_id)
);
alter table contributor_rewards enable row level security;

create or replace function sc_contributor_rewards_give(p_month date default null) returns int
language plpgsql security definer set search_path to 'public' as $$
declare
  mon date := date_trunc('month', coalesce(p_month, (now() at time zone 'Europe/London')::date - interval '1 month'))::date;
  x jsonb; i int := 0; u uuid; m premium_members; k text; given int := 0;
begin
  for x in select * from jsonb_array_elements(sc_social_top_contributors(mon)) loop
    i := i + 1;
    u := (x ->> 'user_id')::uuid;
    if exists (select 1 from contributor_rewards where month = mon and user_id = u) then continue; end if;
    select * into m from premium_members where user_id = u;
    if found and m.stripe_subscription is not null and m.stripe_status in ('active', 'trialing', 'past_due') then
      k := 'stripe_credit';
    elsif found and m.until is null then
      k := 'has_premium';   -- given by hand with no end date: nothing to add
    else
      k := 'free_month';
      insert into premium_members (user_id, until, note) values (u, (current_date + interval '1 month')::date, 'Top contributor')
      on conflict (user_id) do update set
        until = (greatest(coalesce(premium_members.until, current_date), current_date) + interval '1 month')::date;
    end if;
    insert into contributor_rewards (month, user_id, rank, kind, given_at)
    values (mon, u, i, k, case when k = 'stripe_credit' then null else now() end);
    insert into notifications (user_id, kind, title, body, link, dedupe_key)
    values (u, 'reward', 'Top ' || i || ' contributor in ' || trim(to_char(mon, 'Month')) || '!',
      case k when 'stripe_credit' then 'Thank you! Your next month of Premium is on us: a month''s credit has been added to your subscription.'
             when 'has_premium' then 'Thank you for everything you added to the archive this month.'
             else 'Thank you! Here''s a free month of Premium: Local Cuts, the premium profile and the ◆ badge.' end,
      '/premium', 'reward-' || mon)
    on conflict do nothing;
    given := given + 1;
  end loop;
  return given;
end $$;
revoke execute on function sc_contributor_rewards_give(date) from public, anon, authenticated;

-- The billing function: Stripe credits still to send, and marking them sent.
create or replace function sc_rewards_pending(p_secret text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('month', r.month, 'user_id', r.user_id, 'customer', c.customer_id, 'rank', r.rank))
    from contributor_rewards r join stripe_customers c on c.user_id = r.user_id
    where r.kind = 'stripe_credit' and r.given_at is null), '[]');
end $$;
create or replace function sc_reward_done(p_secret text, p_month date, p_user uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  update contributor_rewards set given_at = now() where month = p_month and user_id = p_user and given_at is null;
end $$;
revoke execute on function sc_rewards_pending(text), sc_reward_done(text, date, uuid) from public, anon, authenticated;

-- On the 1st at 09:05 (London): give last month's rewards, then send any Stripe credits.
select cron.unschedule('contributor-rewards') where exists (select 1 from cron.job where jobname = 'contributor-rewards');
select cron.schedule('contributor-rewards', '5 9 1 * *', $c$
  select public.sc_contributor_rewards_give();
  select net.http_post(url := 'https://pcuyzaamcsegblrauxsa.supabase.co/functions/v1/billing',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.sc_private_settings where key = 'cron_secret')),
    body := '{"action":"rewards"}'::jsonb, timeout_milliseconds := 30000);
$c$);

-- The roundup caption says what the top 3 get.
do $d$
declare src text := pg_get_functiondef('public.sc_social_build(date)'::regprocedure); n text;
begin
  if position('free month of Premium' in src) > 0 then return; end if;
  n := replace(src, $q$'. Thank you!'$q$, $q$'. Thank you! Each gets a free month of Premium.'$q$);
  if n = src then raise exception 'sc_social_build not patched'; end if;
  execute n;
end $d$;
