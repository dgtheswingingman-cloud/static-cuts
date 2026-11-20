-- Claude: about £5 a month, site wide.
--
-- Every Claude call now records what it really cost (Claude's reply says how
-- many tokens went in and out): ai_spend, one row per day and job.
-- Haiku 5.5 is $0.10 per million tokens in (prompts up to 100k) and $0.50 per
-- million out (platform.claude.com pricing, Nov 2026).
--
-- The monthly cap is in dollars because Claude bills in dollars:
--   claude_month_usd (sc_private_settings), default 5.20
--   = £5 at about $1.25 to the pound, with room for 20% VAT if your account
--   is charged it ($5.20 + 20% = $6.24 ≈ £5).
-- Who gets what (sc_ai_can_spend):
--   'person'      Local Cuts asks from premium members and sheet imports:
--                 up to the whole month, and at most 3 days' share in one day
--   'background'  NIX's jobs (sub-version checks, blurbs): up to 60% of the
--                 month and 1.5 days' share a day, so people always come first
-- And a hard stop for everything in sc_api_allow('claude') at the cap.
-- NIX on your PC (Ollama) costs nothing and doesn't count.

create table if not exists public.ai_spend (
  day date not null default (now() at time zone 'utc')::date,
  job text not null,
  calls int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  usd numeric(12, 6) not null default 0,
  primary key (day, job)
);
alter table public.ai_spend enable row level security;

create or replace function public.sc_ai_month_cap()
returns numeric language sql stable security definer set search_path to 'public' as $$
  select coalesce((select nullif(value, '')::numeric from sc_private_settings where key = 'claude_month_usd'), 5.20);
$$;

create or replace function public.sc_ai_month_usd()
returns numeric language sql stable security definer set search_path to 'public' as $$
  select coalesce(sum(usd), 0) from ai_spend
  where day >= date_trunc('month', now() at time zone 'utc')::date;
$$;

-- Record one call (edge functions, after Claude answered).
create or replace function public.sc_ai_spend_add(p_job text, p_input bigint, p_output bigint)
returns numeric language plpgsql security definer set search_path to 'public' as $$
declare cost numeric;
begin
  cost := greatest(coalesce(p_input, 0), 0) / 1e6 * (case when p_input > 100000 then 0.50 else 0.10 end)
        + greatest(coalesce(p_output, 0), 0) / 1e6 * (case when p_input > 100000 then 2.50 else 0.50 end);
  insert into ai_spend (job, calls, input_tokens, output_tokens, usd)
  values (left(coalesce(p_job, 'other'), 40), 1, greatest(coalesce(p_input, 0), 0), greatest(coalesce(p_output, 0), 0), cost)
  on conflict (day, job) do update set calls = ai_spend.calls + 1,
    input_tokens = ai_spend.input_tokens + excluded.input_tokens,
    output_tokens = ai_spend.output_tokens + excluded.output_tokens,
    usd = ai_spend.usd + excluded.usd;
  return cost;
end $$;

-- May this kind of work spend now?
create or replace function public.sc_ai_can_spend(p_who text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare
  cap numeric := sc_ai_month_cap();
  month numeric := sc_ai_month_usd();
  today numeric := coalesce((select sum(usd) from ai_spend where day = (now() at time zone 'utc')::date), 0);
  days int := extract(day from (date_trunc('month', now()) + interval '1 month - 1 day'))::int;
  share numeric := cap / days;
begin
  if p_who = 'background' then
    return month < cap * 0.6 and today < share * 1.5;
  end if;
  return month < cap and today < share * 3;
end $$;

revoke all on function public.sc_ai_month_cap(), public.sc_ai_month_usd(), public.sc_ai_spend_add(text, bigint, bigint),
  public.sc_ai_can_spend(text) from public, anon, authenticated;
grant execute on function public.sc_ai_spend_add(text, bigint, bigint), public.sc_ai_can_spend(text) to service_role;

-- Hard stop: no Claude tickets at all once the month's cap is reached.
do $$
declare d text := pg_get_functiondef('public.sc_api_allow'::regproc);
declare anchor text := 'if pause_until is not null and pause_until::timestamptz > now() then return 0; end if;';
begin
  if position('sc_ai_month_usd' in d) > 0 then return; end if;
  if position(anchor in d) = 0 then raise exception 'anchor missing'; end if;
  d := replace(d, anchor, anchor || '
  if p_service = ''claude'' and sc_ai_month_usd() >= sc_ai_month_cap() then return 0; end if;');
  execute d;
end $$;

-- For the NIX page: this month's Claude spend.
create or replace function public.admin_ai_spend()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when is_admin() then jsonb_build_object(
    'cap_usd', sc_ai_month_cap(),
    'month_usd', sc_ai_month_usd(),
    'today_usd', coalesce((select sum(usd) from ai_spend where day = (now() at time zone 'utc')::date), 0),
    'calls_month', coalesce((select sum(calls) from ai_spend where day >= date_trunc('month', now() at time zone 'utc')::date), 0),
    'by_job', (select coalesce(jsonb_agg(jsonb_build_object('job', job, 'calls', calls, 'usd', usd) order by usd desc), '[]') from (
        select job, sum(calls) calls, round(sum(usd), 4) usd from ai_spend
        where day >= date_trunc('month', now() at time zone 'utc')::date group by job) s))
  end;
$$;
revoke all on function public.admin_ai_spend() from public, anon;
grant execute on function public.admin_ai_spend() to authenticated;
