-- The PC's model list is jsonb, not an array: "= any (w.models)" made every
-- claim fail from 25 Nov 13:30 (NIX stopped picking up work). Use jsonb's ?.
CREATE OR REPLACE FUNCTION public.nix_ai_claim(p_worker text, p_model text, p_picks boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare j nix_ai_jobs; m text;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  select * into j from nix_ai_jobs where status = 'queued' and (p_picks or want_model is null)
  order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  m := case when j.want_model is not null and exists (
              select 1 from nix_ai_workers w where w.worker = left(p_worker, 80) and w.models ? j.want_model)
            then j.want_model else p_model end;
  update nix_ai_jobs set status = 'running', worker = left(p_worker, 80), model = left(m, 120), claimed_at = now()
  where id = j.id;
  return jsonb_build_object('id', j.id, 'kind', j.kind, 'prompt', j.prompt, 'json', j.json_reply, 'model', m);
end $function$;
