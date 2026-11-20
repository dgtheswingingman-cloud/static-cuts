-- NIX local AI: AI work runs free on Nathan's PC (Ollama) when it's switched on.
--
-- The desktop app ("Run NIX on this PC", owner only) checks in every 30 s
-- (nix_ai_heartbeat), takes queued jobs one at a time (nix_ai_claim), runs
-- them on the PC's own model and hands back the answer (nix_ai_finish).
-- The AI jobs (version-ai, aotw-blurb) queue their prompt here instead of
-- calling Claude while a PC is online (sc_nix_ai_online), then collect the
-- answers on a later run (sc_nix_ai_collect) and save them exactly as before.
-- When no PC is online they use Claude, as now.
--
-- Local answers on sub-versions are left for review with the PC's note unless
-- nix_ai_auto_apply = 'on' (sc_private_settings), so you can see how good the
-- local model is first.

create table if not exists public.nix_ai_jobs (
  id bigint generated always as identity primary key,
  kind text not null,                 -- 'version-ai' | 'aotw-blurb' | ...
  prompt text not null,
  payload jsonb not null default '{}',-- what the job needs to save the answer
  json_reply boolean not null default true,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'collected')),
  worker text,
  model text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  ms int,
  output text,
  error text
);
create index if not exists nix_ai_jobs_open_idx on public.nix_ai_jobs (status, created_at) where status in ('queued', 'running', 'done');
alter table public.nix_ai_jobs enable row level security;

create table if not exists public.nix_ai_workers (
  worker text primary key,            -- the PC's name
  model text,
  models jsonb not null default '[]',
  ollama boolean not null default false,
  last_seen timestamptz not null default now(),
  jobs_done int not null default 0,
  last_error text
);
alter table public.nix_ai_workers enable row level security;

-- A PC is online when it checked in within the last 2 minutes with Ollama running and a model chosen.
create or replace function public.sc_nix_ai_online()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from nix_ai_workers where last_seen > now() - interval '2 minutes' and ollama and model is not null);
$$;
revoke all on function public.sc_nix_ai_online() from public, anon, authenticated;

-- ---- The PC (owner signed in to the desktop app) ----

create or replace function public.nix_ai_heartbeat(p_worker text, p_ollama boolean, p_model text, p_models jsonb, p_error text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_owner() then raise exception 'owner only'; end if;
  insert into nix_ai_workers (worker, ollama, model, models, last_seen, last_error)
  values (left(p_worker, 80), p_ollama, left(p_model, 120), coalesce(p_models, '[]'), now(), left(p_error, 300))
  on conflict (worker) do update set ollama = excluded.ollama, model = excluded.model, models = excluded.models,
    last_seen = now(), last_error = excluded.last_error;
  -- Jobs a PC took but never finished (closed, asleep) go back in the queue after 15 minutes.
  update nix_ai_jobs set status = 'queued', worker = null, claimed_at = null
  where status = 'running' and claimed_at < now() - interval '15 minutes';
  return jsonb_build_object('queued', (select count(*) from nix_ai_jobs where status = 'queued'));
end $$;

create or replace function public.nix_ai_claim(p_worker text, p_model text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare j nix_ai_jobs;
begin
  if not is_owner() then raise exception 'owner only'; end if;
  select * into j from nix_ai_jobs where status = 'queued' order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  update nix_ai_jobs set status = 'running', worker = left(p_worker, 80), model = left(p_model, 120), claimed_at = now()
  where id = j.id;
  return jsonb_build_object('id', j.id, 'kind', j.kind, 'prompt', j.prompt, 'json', j.json_reply);
end $$;

create or replace function public.nix_ai_finish(p_id bigint, p_output text, p_error text, p_ms int)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare w text;
begin
  if not is_owner() then raise exception 'owner only'; end if;
  update nix_ai_jobs set status = case when p_error is null then 'done' else 'failed' end,
    output = left(p_output, 100000), error = left(p_error, 500), finished_at = now(), ms = p_ms
  where id = p_id and status = 'running'
  returning worker into w;
  if w is not null and p_error is null then
    update nix_ai_workers set jobs_done = jobs_done + 1 where worker = w;
  end if;
  return w is not null;
end $$;

revoke all on function public.nix_ai_heartbeat(text, boolean, text, jsonb, text), public.nix_ai_claim(text, text),
  public.nix_ai_finish(bigint, text, text, int) from public, anon;
grant execute on function public.nix_ai_heartbeat(text, boolean, text, jsonb, text), public.nix_ai_claim(text, text),
  public.nix_ai_finish(bigint, text, text, int) to authenticated;

-- ---- The AI jobs (edge functions, cron secret) ----

-- Whether to send work to the PC, and how much is already waiting for it.
create or replace function public.sc_nix_ai_state(p_secret text, p_kind text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'online', sc_nix_ai_online(),
    'waiting', (select count(*) from nix_ai_jobs where kind = p_kind and status in ('queued', 'running')),
    'auto_apply', coalesce((select value from sc_private_settings where key = 'nix_ai_auto_apply'), 'off') = 'on');
end $$;

create or replace function public.sc_nix_ai_enqueue(p_secret text, p_kind text, p_prompt text, p_payload jsonb, p_json boolean default true)
returns bigint language plpgsql security definer set search_path to 'public' as $$
declare v bigint;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  insert into nix_ai_jobs (kind, prompt, payload, json_reply) values (p_kind, p_prompt, coalesce(p_payload, '{}'), p_json)
  returning id into v;
  return v;
end $$;

-- Finished answers for this kind (marked collected), and failed ones (also
-- marked collected, so their items go back to the normal queue).
create or replace function public.sc_nix_ai_collect(p_secret text, p_kind text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  with got as (
    update nix_ai_jobs set status = 'collected'
    where id in (select id from nix_ai_jobs where kind = p_kind and status in ('done', 'failed') order by id limit 20 for update skip locked)
    returning id, payload, output, error, model)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'payload', payload, 'output', output, 'error', error, 'model', model)), '[]')
  into v from got;
  return v;
end $$;

revoke all on function public.sc_nix_ai_state(text, text), public.sc_nix_ai_enqueue(text, text, text, jsonb, boolean),
  public.sc_nix_ai_collect(text, text) from public, anon, authenticated;
grant execute on function public.sc_nix_ai_state(text, text), public.sc_nix_ai_enqueue(text, text, text, jsonb, boolean),
  public.sc_nix_ai_collect(text, text) to service_role;

-- Old finished jobs are cleared after 14 days (nightly, through NIX).
create or replace function public.sc_nix_ai_trim()
returns int language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  delete from nix_ai_jobs where status in ('collected', 'failed') and created_at < now() - interval '14 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.sc_nix_ai_trim() from public, anon, authenticated;

insert into public.nix_tasks (name, steps, every, max_every, at_time) values
  ('nix-ai-trim', '[{"name":"trimmed","sql":"public.sc_nix_ai_trim()"}]', '1 day', '1 day', '04:50')
on conflict (name) do nothing;
update public.nix_tasks set next_at = date_trunc('day', now()) + interval '1 day' + time '04:50' where name = 'nix-ai-trim' and last_run_at is null;

-- For the NIX page: the PCs and the queue.
create or replace function public.admin_nix_ai()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when is_admin() then jsonb_build_object(
    'online', sc_nix_ai_online(),
    'auto_apply', coalesce((select value from sc_private_settings where key = 'nix_ai_auto_apply'), 'off') = 'on',
    'workers', (select coalesce(jsonb_agg(jsonb_build_object('worker', worker, 'model', model, 'ollama', ollama,
        'last_seen', last_seen, 'jobs_done', jobs_done, 'last_error', last_error) order by last_seen desc), '[]') from nix_ai_workers),
    'queued', (select count(*) from nix_ai_jobs where status = 'queued'),
    'running', (select count(*) from nix_ai_jobs where status = 'running'),
    'done_24h', (select count(*) from nix_ai_jobs where status in ('done', 'collected') and finished_at > now() - interval '24 hours'),
    'failed_24h', (select count(*) from nix_ai_jobs where error is not null and finished_at > now() - interval '24 hours'),
    'avg_s', (select round(avg(ms) / 1000.0, 1) from nix_ai_jobs where ms is not null and finished_at > now() - interval '7 days'))
  end;
$$;
revoke all on function public.admin_nix_ai() from public, anon;
grant execute on function public.admin_nix_ai() to authenticated;
