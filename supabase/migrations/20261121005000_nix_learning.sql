-- NIX learns from your decisions (no retraining: it keeps a record and uses it).
--
-- 1. Accuracy: every AI answer (Claude or NIX on your PC) is kept in
--    nix_answers with the model that gave it. When a person later approves or
--    dismisses that suggestion, the final decision is filled in (trigger), so
--    /nix can show how often each model agreed with you.
-- 2. Lessons: answers you overruled (and ones it was unsure about that you
--    decided) go into its next prompts as worked examples (sc_nix_lessons).
-- 3. Rule suggestions: nightly, NIX looks for version tags you always decide
--    the same way (10+ times, never the other way) and suggests a rule. A
--    rule you switch on is applied hourly to new suggestions (undoable).
-- Sub-versions first; other jobs can use the same tables.

create table if not exists public.nix_answers (
  id bigint generated always as identity primary key,
  kind text not null,
  item_id text not null,
  model text,
  answer text,              -- yes | no | unsure (what the model really said)
  note text,
  line text,                -- the item as the model saw it, for lessons
  created_at timestamptz not null default now(),
  final text,               -- yes | no once decided
  final_at timestamptz,
  final_by text,            -- person | auto | history
  unique (kind, item_id)
);
create index if not exists nix_answers_final_idx on public.nix_answers (kind, final_by, final_at desc);
alter table public.nix_answers enable row level security;

create table if not exists public.nix_rules (
  id bigint generated always as identity primary key,
  kind text not null,
  pattern text not null,    -- version tag, lower case
  action text not null check (action in ('link', 'dismiss')),
  state text not null default 'suggested' check (state in ('suggested', 'on', 'no')),
  said_yes int not null default 0,
  said_no int not null default 0,
  examples jsonb not null default '[]',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  applied int not null default 0,
  unique (kind, pattern)
);
alter table public.nix_rules enable row level security;

-- The suggestion as a short line (same shape as the version-ai prompt).
create or replace function public.sc_version_line(p_id uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select 'artist: ' || coalesce(a.name, '?') || ' | song: "' || coalesce(t.title, '?') || '" (' || coalesce(t.release_status, '?') || ')'
    || ' | suggested main song: "' || coalesce(p.title, vs.create_parent_title, '?') || '"'
    || ' | version tag: ' || coalesce(vs.version, '-')
  from version_suggestions vs
  left join tracks t on t.id = vs.track_id
  left join artists a on a.id = t.artist_id
  left join tracks p on p.id = vs.parent_track_id
  where vs.id = p_id;
$$;

-- Save: also keep each answer (and which model gave it).
create or replace function public.sc_version_ai_save(p_secret text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_yes uuid[]; v_no uuid[]; v_applied int := 0;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  update version_suggestions vs
  set ai_verdict = case when i->>'verdict' in ('yes', 'no') then i->>'verdict' else 'unsure' end,
      ai_note = left(nullif(i->>'note', ''), 300),
      ai_checked_at = now(), ai_claim_at = null
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  where vs.id = (i->>'id')::uuid and vs.state = 'open';

  insert into nix_answers (kind, item_id, model, answer, note, line)
  select 'version-ai', i->>'id', coalesce(nullif(i->>'model', ''), 'claude-haiku-5-5'),
         case when coalesce(i->>'answer', i->>'verdict') in ('yes', 'no') then coalesce(i->>'answer', i->>'verdict') else 'unsure' end,
         left(nullif(i->>'note', ''), 300),
         coalesce(left(nullif(i->>'line', ''), 400), sc_version_line((i->>'id')::uuid))
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  where i->>'id' ~ '^[0-9a-f-]{36}$'
    and exists (select 1 from version_suggestions vs where vs.id = (i->>'id')::uuid and vs.state = 'open')
  on conflict (kind, item_id) do update set model = excluded.model, answer = excluded.answer, note = excluded.note,
    line = excluded.line, created_at = now(), final = null, final_at = null, final_by = null;

  select array_agg(vs.id) filter (where vs.ai_verdict = 'yes' and vs.action <> 'merge'), array_agg(vs.id) filter (where vs.ai_verdict = 'no')
  into v_yes, v_no
  from version_suggestions vs
  where vs.id in (select (i->>'id')::uuid from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i where i->>'id' ~ '^[0-9a-f-]{36}$')
    and vs.state = 'open';
  if v_yes is not null then
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('sub_versions', 'Sub-versions: ' || cardinality(v_yes) || ' approved by Claude');
    v_applied := coalesce(sc_apply_version_suggestions(v_yes), 0);
  end if;
  if v_no is not null then
    update version_suggestions set state = 'dismissed', decided_at = now() where id = any (v_no) and state = 'open';
  end if;
  return jsonb_build_object('yes', coalesce(cardinality(v_yes), 0), 'no', coalesce(cardinality(v_no), 0), 'applied', v_applied);
end;
$$;

-- When a suggestion is decided: fill in the final decision. A person decided
-- it when someone signed in did it (the review page); otherwise it was automatic.
create or replace function public.sc_nix_answer_decided()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if old.state = 'open' and new.state in ('applied', 'dismissed') then
    update nix_answers set final = case when new.state = 'applied' then 'yes' else 'no' end, final_at = now(),
      final_by = case when auth.uid() is not null then 'person' else 'auto' end
    where kind = 'version-ai' and item_id = new.id::text and final is null;
  end if;
  return new;
end $$;
drop trigger if exists nix_answer_decided on public.version_suggestions;
create trigger nix_answer_decided after update of state on public.version_suggestions
  for each row execute function public.sc_nix_answer_decided();

-- History: suggestions Claude was unsure about that were then decided (a
-- person, since "unsure" is never applied by Claude), so lessons and rule
-- suggestions start with what's already known.
insert into public.nix_answers (kind, item_id, model, answer, note, line, created_at, final, final_at, final_by)
select 'version-ai', vs.id::text, 'claude-haiku-5-5', 'unsure', vs.ai_note, sc_version_line(vs.id), coalesce(vs.ai_checked_at, vs.created_at),
       case when vs.state = 'applied' then 'yes' else 'no' end, coalesce(vs.decided_at, vs.ai_checked_at), 'history'
from version_suggestions vs
where vs.ai_verdict = 'unsure' and vs.state in ('applied', 'dismissed')
on conflict (kind, item_id) do nothing;

-- Lessons for the next prompt: the most recent cases a person decided
-- differently from what the model said (including "unsure"), newest first,
-- one per version tag so they cover different situations.
create or replace function public.sc_nix_lessons(p_kind text, p_limit int default 12)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('line', line, 'answer', final) order by final_at desc), '[]') from (
    select line, final, final_at from (
      select distinct on (lower(coalesce(substring(line from 'version tag: (.*)$'), line))) line, final, final_at
      from nix_answers
      where kind = p_kind and final_by in ('person', 'history') and line is not null and answer is distinct from final
        and final_at > now() - interval '180 days'
      order by lower(coalesce(substring(line from 'version tag: (.*)$'), line)), final_at desc
    ) per_tag
    order by final_at desc
    limit greatest(1, least(p_limit, 30))
  ) d;
$$;

-- Nightly: tags you always decide the same way become rule suggestions.
create or replace function public.sc_nix_rules_find()
returns int language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  with decided as (
    select lower(trim(vs.version)) tag, a.final, coalesce(a.line, '') line, a.final_at
    from nix_answers a join version_suggestions vs on vs.id = a.item_id::uuid
    where a.kind = 'version-ai' and a.final_by in ('person', 'history') and nullif(trim(vs.version), '') is not null
  ), tags as (
    select tag, count(*) filter (where final = 'yes') yes, count(*) filter (where final = 'no') no,
           (array_agg(line order by final_at desc))[1:3] ex
    from decided
    where tag !~ '^[0-9]+$' and length(tag) between 3 and 60   -- not bare numbers or years
    group by tag
  ), found as (
    select tag, case when no = 0 then 'link' else 'dismiss' end action, yes, no, to_jsonb(ex) ex
    from tags where (yes >= 10 and no = 0) or (no >= 10 and yes = 0)
  )
  insert into nix_rules (kind, pattern, action, said_yes, said_no, examples)
  select 'version-ai', tag, action, yes, no, ex from found
  on conflict (kind, pattern) do update set said_yes = excluded.said_yes, said_no = excluded.said_no, examples = excluded.examples
    where nix_rules.state = 'suggested';
  get diagnostics n = row_count;
  return n;
end $$;

-- Hourly: rules you switched on, applied to open suggestions (undoable).
create or replace function public.sc_nix_rules_apply()
returns int language plpgsql security definer set search_path to 'public' as $$
declare r record; ids uuid[]; total int := 0; k int;
begin
  for r in select * from nix_rules where kind = 'version-ai' and state = 'on' loop
    select array_agg(id) into ids from version_suggestions
    where state = 'open' and lower(trim(version)) = r.pattern and (r.action = 'dismiss' or action <> 'merge');
    if ids is null then continue; end if;
    if r.action = 'link' then
      perform set_config('static_cuts.batch_id', '', true);
      perform sc_begin_batch('sub_versions', 'NIX rule: always link "' || r.pattern || '" versions (' || cardinality(ids) || ')');
      k := coalesce(sc_apply_version_suggestions(ids), 0);
    else
      update version_suggestions set state = 'dismissed', decided_at = now() where id = any (ids) and state = 'open';
      get diagnostics k = row_count;
    end if;
    update nix_rules set applied = applied + k where id = r.id;
    total := total + k;
  end loop;
  return total;
end $$;

revoke all on function public.sc_version_line(uuid), public.sc_nix_lessons(text, int), public.sc_nix_rules_find(),
  public.sc_nix_rules_apply() from public, anon, authenticated;
grant execute on function public.sc_nix_lessons(text, int) to service_role;

insert into public.nix_tasks (name, steps, every, max_every, at_time) values
  ('nix-rules-find',  '[{"name":"suggested","sql":"public.sc_nix_rules_find()"}]', '1 day', '1 day', '04:55'),
  ('nix-rules-apply', '[{"name":"applied","sql":"public.sc_nix_rules_apply()"}]', '1 hour', '1 hour', null)
on conflict (name) do nothing;
update public.nix_tasks set next_at = now() + interval '2 minutes' where name in ('nix-rules-find', 'nix-rules-apply') and last_run_at is null;

-- For the NIX page.
create or replace function public.admin_nix_learning()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when is_admin() then jsonb_build_object(
    'models', (select coalesce(jsonb_agg(m order by m->>'model'), '[]') from (
        select jsonb_build_object('model', model,
          'decided', count(*),
          'said', count(*) filter (where answer in ('yes', 'no')),
          'right', count(*) filter (where answer = final),
          'unsure', count(*) filter (where answer = 'unsure')) m
        from nix_answers where kind = 'version-ai' and final_by = 'person' and final_at > now() - interval '90 days'
        group by model) s),
    'answers_30d', (select count(*) from nix_answers where kind = 'version-ai' and created_at > now() - interval '30 days'),
    'lessons', (select jsonb_array_length(sc_nix_lessons('version-ai', 12))),
    'lesson_examples', sc_nix_lessons('version-ai', 5),
    'rules', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'pattern', pattern, 'action', action, 'state', state,
        'said_yes', said_yes, 'said_no', said_no, 'examples', examples, 'applied', applied) order by state = 'suggested' desc, greatest(said_yes, said_no) desc), '[]')
      from nix_rules where kind = 'version-ai' and state <> 'no'),
    'open_matching', (select coalesce(jsonb_object_agg(r.id, (select count(*) from version_suggestions vs
        where vs.state = 'open' and lower(trim(vs.version)) = r.pattern)), '{}') from nix_rules r where r.state = 'suggested'))
  end;
$$;
revoke all on function public.admin_nix_learning() from public, anon;
grant execute on function public.admin_nix_learning() to authenticated;

-- Owner: switch a suggested rule on, or say no to it (or switch one off again).
create or replace function public.admin_nix_rule_set(p_id bigint, p_state text)
returns boolean language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_owner() then raise exception 'owner only'; end if;
  if p_state not in ('on', 'no', 'suggested') then raise exception 'unknown state'; end if;
  update nix_rules set state = p_state, decided_at = now() where id = p_id;
  if not found then return false; end if;
  if p_state = 'on' then
    update nix_tasks set next_at = now() where name = 'nix-rules-apply';
  end if;
  return true;
end $$;
revoke all on function public.admin_nix_rule_set(bigint, text) from public, anon;
grant execute on function public.admin_nix_rule_set(bigint, text) to authenticated;
