-- Weekly NIX summary (Nathan, 25 Nov). Every Monday morning NIX writes up
-- its week: what the PC answered, how often it was right (Claude's check
-- and the final say), what got changed on the site, what's waiting for you,
-- and what Claude cost. It's sent to the owner as a notification (so it
-- reaches their phone if phone alerts are on) and kept in nix_weekly for
-- the Control room's NIX tab. The owner's account is read from the setting
-- owner_user_id.

create table if not exists public.nix_weekly (
  week_start date primary key,
  made_at timestamptz not null default now(),
  report jsonb not null
);
alter table public.nix_weekly enable row level security;

create or replace function public.sc_nix_weekly_build(p_force boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  wk date := (date_trunc('week', now() at time zone 'Europe/London'))::date;  -- this Monday
  since timestamptz := now() - interval '7 days';
  owner uuid := (select nullif(value, '')::uuid from sc_private_settings where key = 'owner_user_id');
  r jsonb; lines text[] := '{}';
  pc_jobs int; pc_failed int; answered int; right_n int; wrong_n int; judged int; nix_right int;
  accepted int; linked int; merged int; agree_wait int; corrected_wait int; links_wait int;
  usd_week numeric; usd_month numeric; cap numeric; failing text; by_kind text;
begin
  if not p_force then
    if extract(isodow from now() at time zone 'Europe/London') <> 1 then return null; end if;
    if exists (select 1 from nix_weekly where week_start = wk) then return null; end if;
  end if;

  select count(*), count(*) filter (where status = 'failed') into pc_jobs, pc_failed
  from nix_ai_jobs where finished_at > since;
  select count(*) into answered from nix_notes where created_at > since;
  select string_agg(kind || ' ' || n, ', ' order by n desc) into by_kind
  from (select kind, count(*) n from nix_notes where created_at > since group by kind) x;

  select
    (select count(*) from nix_notes where checked_at > since and (check_verdict = 'agree' or final_side = 'nix'))
      + (select count(*) from nix_suggestions where checked_at > since and check_verdict = 'agree'),
    (select count(*) from nix_notes where checked_at > since and check_verdict = 'disagree' and coalesce(final_side, '') <> 'nix')
      + (select count(*) from nix_suggestions where checked_at > since and check_verdict in ('disagree', 'corrected'))
  into right_n, wrong_n;
  select (select count(*) from nix_notes where judged_at > since) + (select count(*) from nix_suggestions where judged_at > since),
         (select count(*) from nix_notes where judged_at > since and final_side = 'nix') + (select count(*) from nix_suggestions where judged_at > since and final_side = 'nix')
  into judged, nix_right;

  select count(*) into accepted from nix_suggestions where state = 'accepted' and decided_at > since;
  select count(*) into linked from change_log l join change_batches b on b.id = l.batch_id
  where b.kind = 'links' and b.created_at > since and l.table_name = 'tracks' and l.op = 'UPDATE';
  select count(*) into merged from change_log l join change_batches b on b.id = l.batch_id
  where b.kind = 'merge' and b.created_at > since and l.table_name = 'tracks' and l.op = 'DELETE';

  select count(*) filter (where check_verdict = 'agree'), count(*) filter (where check_verdict = 'corrected')
  into agree_wait, corrected_wait from nix_suggestions where state = 'open';
  select count(*) into links_wait from track_link_candidates c join nix_notes n on n.kind = 'links' and n.item_key = c.id::text
  where case when n.final_side in ('checker', 'neither') then n.final_answer when n.final_side = 'nix' or n.check_verdict = 'agree' then n.verdict end = 'match';

  select coalesce(sum(usd), 0) into usd_week from ai_spend where day > (now() at time zone 'utc')::date - 7;
  usd_month := sc_ai_month_usd(); cap := sc_ai_month_cap();
  select string_agg(job, ', ') into failing from (
    select coalesce(label, job) job from job_runs where started_at > since and (status <> 200 or error is not null)
    group by 1 having count(*) >= 5 order by count(*) desc limit 4) f;

  lines := array[
    format('The PC answered %s batches (%s failed): %s answers%s.', pc_jobs, pc_failed, answered, coalesce(' (' || by_kind || ')', '')),
    case when right_n + wrong_n > 0 then format('Claude found %s%% of what it checked right (%s of %s).', round(100.0 * right_n / (right_n + wrong_n)), right_n, right_n + wrong_n)
         else 'Claude had nothing new to check.' end,
    case when judged > 0 then format('The final say settled %s disagreements: NIX was right on %s.', judged, nix_right) end,
    format('Changed on the site: %s suggestions you accepted, %s songs given a link, %s duplicate copies merged.', accepted, linked, merged),
    format('Waiting for you: %s suggestions Claude agrees with, %s Claude corrected, %s right links.', agree_wait, corrected_wait, links_wait),
    format('Claude cost $%s this week ($%s of $%s this month).', to_char(usd_week, 'FM990.00'), to_char(usd_month, 'FM990.00'), to_char(cap, 'FM990.00')),
    case when failing is not null then 'Needs a look: ' || failing || '.' end
  ];
  lines := array_remove(lines, null);

  r := jsonb_build_object('week_start', wk, 'lines', to_jsonb(lines),
    'numbers', jsonb_build_object('pc_jobs', pc_jobs, 'pc_failed', pc_failed, 'answered', answered, 'right', right_n, 'wrong', wrong_n,
      'judged', judged, 'nix_right', nix_right, 'accepted', accepted, 'linked', linked, 'merged', merged,
      'agree_waiting', agree_wait, 'corrected_waiting', corrected_wait, 'links_waiting', links_wait,
      'usd_week', round(usd_week, 2), 'usd_month', round(usd_month, 2)));
  insert into nix_weekly (week_start, report) values (wk, r)
  on conflict (week_start) do update set report = excluded.report, made_at = now();

  if owner is not null then
    insert into notifications (user_id, kind, title, body, link, dedupe_key)
    values (owner, 'nix',
      format('NIX this week: %s answers, %s right', answered,
        case when right_n + wrong_n > 0 then round(100.0 * right_n / (right_n + wrong_n)) || '%' else 'nothing checked' end),
      format('%s waiting for you. Claude $%s this week.', agree_wait + corrected_wait + links_wait, to_char(usd_week, 'FM990.00')),
      '/control?tab=nix', 'nix-weekly-' || wk);
  end if;
  return r;
end $$;
revoke all on function public.sc_nix_weekly_build(boolean) from public, anon, authenticated;

create or replace function public.admin_nix_weekly()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when is_admin() then coalesce((select jsonb_agg(report order by week_start desc) from (select * from nix_weekly order by week_start desc limit 4) w), '[]') end;
$$;
revoke all on function public.admin_nix_weekly() from public, anon;
grant execute on function public.admin_nix_weekly() to authenticated;

insert into public.nix_tasks (name, steps, every, max_every, at_time) values
  ('nix-weekly', '[{"name":"report","sql":"public.sc_nix_weekly_build() is not null"}]', '1 day', '1 day', '07:53')
on conflict (name) do nothing;
update public.nix_tasks set next_at = date_trunc('day', now()) + interval '1 day' + time '07:53' where name = 'nix-weekly' and last_run_at is null;

-- Numbers with thousands separators, and safe to run again in the same week.
do $$
declare d text := pg_get_functiondef('public.sc_nix_weekly_build'::regproc);
begin
  d := replace(d, 'format(''NIX this week: %s answers, %s right'', answered,', 'format(''NIX this week: %s answers, %s right'', to_char(answered, ''FM999,999,990''),');
  d := replace(d, 'format(''%s waiting for you. Claude $%s this week.'', agree_wait + corrected_wait + links_wait,', 'format(''%s waiting for you. Claude $%s this week.'', to_char(agree_wait + corrected_wait + links_wait, ''FM999,999,990''),');
  d := replace(d, 'format(''The PC answered %s batches (%s failed): %s answers%s.'', pc_jobs, pc_failed, answered,', 'format(''The PC answered %s batches (%s failed): %s answers%s.'', to_char(pc_jobs, ''FM999,999,990''), pc_failed, to_char(answered, ''FM999,999,990''),');
  d := replace(d, '''/control?tab=nix'', ''nix-weekly-'' || wk);', '''/control?tab=nix'', ''nix-weekly-'' || wk)
    on conflict do nothing;');
  if position('to_char(answered' in d) = 0 or position('on conflict do nothing' in d) = 0 then raise exception 'patch missed'; end if;
  execute d;
end $$;
