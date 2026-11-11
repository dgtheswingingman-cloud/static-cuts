-- Premium through Stripe: people pay on Stripe's checkout (£3 a month or £24
-- a year) and their premium_members row follows their subscription. The
-- billing edge function does the Stripe side; these are what it calls.
-- Premium the owner gave by hand with no end date is never shortened.

create table if not exists stripe_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  customer_id text not null unique,
  created_at timestamptz not null default now()
);
alter table stripe_customers enable row level security;

alter table premium_members add column if not exists stripe_subscription text;
alter table premium_members add column if not exists stripe_status text;

-- The billing function: remember someone's Stripe customer.
create or replace function sc_stripe_customer_save(p_user uuid, p_customer text) returns void
language sql security definer set search_path to 'public' as $$
  insert into stripe_customers (user_id, customer_id) values (p_user, p_customer)
  on conflict (user_id) do update set customer_id = excluded.customer_id;
$$;

-- The billing function: a subscription changed. Active (or trialing / past
-- due, which Stripe is still retrying) = premium until the end of the paid
-- period plus 3 days' grace; anything else = premium ends with the period.
create or replace function sc_stripe_subscription_save(p_customer text, p_subscription text, p_status text, p_period_end timestamptz)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u uuid; m premium_members; v_until date;
begin
  select user_id into u from stripe_customers where customer_id = p_customer;
  if u is null then return jsonb_build_object('ok', false, 'why', 'unknown customer'); end if;
  v_until := (p_period_end at time zone 'Europe/London')::date
    + case when p_status in ('active', 'trialing', 'past_due') then 3 else 0 end;
  select * into m from premium_members where user_id = u;
  if found and m.until is null and m.stripe_subscription is null then
    -- given by hand, no end date: keep it, just note the subscription
    update premium_members set stripe_subscription = p_subscription, stripe_status = p_status where user_id = u;
    return jsonb_build_object('ok', true, 'user', u, 'kept', true);
  end if;
  insert into premium_members (user_id, until, note, stripe_subscription, stripe_status)
  values (u, v_until, 'Stripe', p_subscription, p_status)
  on conflict (user_id) do update set
    until = case when premium_members.until is not null and premium_members.stripe_subscription is null and premium_members.until > excluded.until
                 then premium_members.until else excluded.until end,
    note = coalesce(premium_members.note, 'Stripe'),
    stripe_subscription = excluded.stripe_subscription, stripe_status = excluded.stripe_status;
  return jsonb_build_object('ok', true, 'user', u, 'until', v_until);
end $$;
revoke execute on function sc_stripe_customer_save(uuid, text), sc_stripe_subscription_save(text, text, text, timestamptz) from public, anon, authenticated;

-- For the page: am I premium, until when, and is it a Stripe subscription
-- (so the page can offer "manage or cancel").
create or replace function rpc_my_premium()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('premium', is_premium(auth.uid()),
    'until', (select until from premium_members where user_id = auth.uid()),
    'stripe', (select stripe_status from premium_members where user_id = auth.uid() and stripe_subscription is not null),
    'customer', exists (select 1 from stripe_customers where user_id = auth.uid()));
$$;
revoke execute on function rpc_my_premium() from public;
grant execute on function rpc_my_premium() to anon, authenticated;
