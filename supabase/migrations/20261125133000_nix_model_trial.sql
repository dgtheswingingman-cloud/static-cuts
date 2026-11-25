-- Model trial (25 Nov): which model on the owner's PC does NIX's work best?
-- The PC has qwen2.5:7b (in use), qwen3:4b-instruct and qwen3:4b installed.
-- The same batches of review items that already have a settled answer
-- (Claude agreed with NIX, or the final say decided) are sent to each model,
-- and each model's answers are scored against that answer key.
--
-- A job can now ask for a model (want_model): the PC uses it when it has it
-- installed. Trial jobs are kind 'trial:<job>', so nothing they answer is
-- saved as a note or touches the site. Results: sc_nix_trial_results().

alter table public.nix_ai_jobs add column if not exists want_model text;

-- p_picks: the PC's app can run a job on a model other than its own (app
-- from 25 Nov). Older apps never get jobs that ask for a model.
drop function if exists public.nix_ai_claim(text, text);
create or replace function public.nix_ai_claim(p_worker text, p_model text, p_picks boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare j nix_ai_jobs; m text;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  select * into j from nix_ai_jobs where status = 'queued' and (p_picks or want_model is null)
  order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  -- A job that asks for a model gets it when this PC has it installed.
  m := case when j.want_model is not null and exists (
              select 1 from nix_ai_workers w where w.worker = left(p_worker, 80) and j.want_model = any (w.models))
            then j.want_model else p_model end;
  update nix_ai_jobs set status = 'running', worker = left(p_worker, 80), model = left(m, 120), claimed_at = now()
  where id = j.id;
  return jsonb_build_object('id', j.id, 'kind', j.kind, 'prompt', j.prompt, 'json', j.json_reply, 'model', m);
end $$;

-- The answer that stands for a review note, or null when nothing settled it.
create or replace function public.sc_nix_settled(n public.nix_notes)
returns text language sql immutable as $$
  select case when n.final_side in ('checker', 'neither') then n.final_answer
              when n.final_side = 'nix' or n.check_verdict = 'agree' then n.verdict end;
$$;

create or replace function public.sc_nix_trial_start(p_models text[] default array['qwen2.5:7b', 'qwen3:4b-instruct', 'qwen3:4b'], p_batches int default 3)
returns int language plpgsql security definer set search_path to 'public' as $$
declare k text; b int; items jsonb; v_prompt text; m text; made int := 0; run text := to_char(now(), 'YYYYMMDDHH24MI');
begin
  foreach k in array array['duplicates', 'cleanup', 'links'] loop
    for b in 1..p_batches loop
      -- answered items with a settled answer, wrong ones over-represented so the trial is a real test
      select jsonb_agg(jsonb_build_object('key', x.item_key, 'line', x.line, 'answer', x.settled)) into items from (
        select n.item_key, n.line, sc_nix_settled(n) settled from nix_notes n
        where n.kind = k and n.line is not null and sc_nix_settled(n) is not null
        order by (sc_nix_settled(n) <> n.verdict) desc, md5(n.item_key || run || b) limit case k when 'cleanup' then 30 else 20 end
        offset (b - 1) * case k when 'cleanup' then 30 else 20 end) x;
      continue when items is null;
      v_prompt := sc_nix_review_prompt(k, items);
      v_prompt := replace(v_prompt, E'\n\nReply with JSON only', sc_nix_lessons_text(k, 8) || E'\n\nReply with JSON only');
      foreach m in array p_models loop
        insert into nix_ai_jobs (kind, prompt, payload, json_reply, want_model)
        values ('trial:' || k, v_prompt, jsonb_build_object('run', run, 'model', m,
                  'keys', (select jsonb_agg(x -> 'key') from jsonb_array_elements(items) x),
                  'answers', (select jsonb_agg(x -> 'answer') from jsonb_array_elements(items) x)), false, m);
        made := made + 1;
      end loop;
    end loop;
  end loop;
  return made;
end $$;

create or replace function public.sc_nix_trial_results()
returns table (model text, job text, batches int, answered int, right_n int, accuracy numeric, avg_s numeric, wrong_model int)
language sql stable security definer set search_path to 'public' as $$
  with j as (
    select j.payload ->> 'model' wanted, j.model used, substring(j.kind from 7) job, j.ms, j.payload, j.output, j.status
    from nix_ai_jobs j where j.kind like 'trial:%' and j.status in ('done', 'failed', 'collected')),
  a as (
    select j.wanted, j.job, j.ms, j.used, r.value r, j.payload
    from j cross join lateral jsonb_array_elements(case when j.output is null then '[]'::jsonb else sc_nix_parse(j.output) end) r)
  select j.wanted, j.job, count(distinct j.payload) :: int,
    (select count(*) from a where a.wanted = j.wanted and a.job = j.job
       and lower(a.r ->> 'v') is not null)::int,
    (select count(*) from a where a.wanted = j.wanted and a.job = j.job
       and lower(a.r ->> 'v') = (a.payload -> 'answers' ->> ((a.r ->> 'n')::int - 1)))::int,
    round(100.0 * (select count(*) from a where a.wanted = j.wanted and a.job = j.job
       and lower(a.r ->> 'v') = (a.payload -> 'answers' ->> ((a.r ->> 'n')::int - 1)))
      / nullif((select sum(jsonb_array_length(x.payload -> 'keys')) from j x where x.wanted = j.wanted and x.job = j.job), 0), 1),
    round(avg(j.ms) / 1000.0, 1),
    count(*) filter (where j.used is distinct from j.wanted)::int
  from j group by j.wanted, j.job order by j.job, j.wanted;
$$;
revoke all on function public.nix_ai_claim(text, text, boolean) from public, anon;
grant execute on function public.nix_ai_claim(text, text, boolean) to authenticated;
revoke all on function public.sc_nix_trial_start(text[], int), public.sc_nix_trial_results() from public, anon, authenticated;
