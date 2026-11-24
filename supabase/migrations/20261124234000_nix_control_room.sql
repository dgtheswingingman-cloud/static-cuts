-- NIX control room rework (24 Nov): what the new /nix page reads.
--   admin_nix_jobs_progress  + the final say for each job (NIX right / wrong /
--                              corrected) and whether NIX is still making it
--   admin_nix_kinds          which suggestion jobs NIX makes (owner switches)
--   admin_nix_lessons        the worked examples NIX's next prompt for a job
--                              will carry (what it's being taught right now)

do $$
declare d text := pg_get_functiondef('public.admin_nix_jobs_progress'::regproc);
begin
  d := replace(d, '''to_check'', case',
    '''judged'', case when k.src = ''suggest'' then (select count(*) from nix_suggestions s where s.kind = k.kind and s.judged_at is not null)
        else (select count(*) from nix_notes n where n.kind = k.kind and n.judged_at is not null) end,
      ''nix_right'', case when k.src = ''suggest'' then (select count(*) from nix_suggestions s where s.kind = k.kind and s.final_side = ''nix'')
        else (select count(*) from nix_notes n where n.kind = k.kind and n.final_side = ''nix'') end,
      ''nix_wrong'', case when k.src = ''suggest'' then (select count(*) from nix_suggestions s where s.kind = k.kind and s.final_side in (''checker'', ''neither''))
        else (select count(*) from nix_notes n where n.kind = k.kind and n.final_side in (''checker'', ''neither'')) end,
      ''to_judge'', case when k.src = ''suggest'' then (select count(*) from nix_suggestions s where s.kind = k.kind and s.state = ''open'' and s.check_verdict = ''disagree'' and s.judged_at is null)
        else (select count(*) from nix_notes n where n.kind = k.kind and n.check_verdict = ''disagree'' and n.judged_at is null and n.line is not null) end,
      ''making'', case when k.src = ''suggest''
        then k.kind = any (string_to_array(coalesce((select value from sc_private_settings where key = ''nix_suggest_kinds''), ''titles,audit,notes,eras''), '',''))
        else true end,
      ''to_check'', case');
  if position('''nix_right''' in d) = 0 then raise exception 'progress patch missed'; end if;
  execute d;
end $$;

create or replace function public.admin_nix_kinds(p_kind text default null, p_on boolean default null)
returns text[] language plpgsql security definer set search_path to 'public' as $$
declare cur text[];
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  cur := string_to_array(coalesce((select value from sc_private_settings where key = 'nix_suggest_kinds'), 'titles,audit,notes,eras'), ',');
  if p_kind is null then return cur; end if;
  if not is_owner() then raise exception 'owner only'; end if;
  if p_kind not in ('titles', 'audit', 'notes', 'eras') then raise exception 'unknown job'; end if;
  cur := array_remove(cur, p_kind);
  if p_on then cur := cur || p_kind; end if;
  insert into sc_private_settings (key, value) values ('nix_suggest_kinds', array_to_string(cur, ','))
  on conflict (key) do update set value = excluded.value;
  return cur;
end $$;
revoke all on function public.admin_nix_kinds(text, boolean) from public, anon;
grant execute on function public.admin_nix_kinds(text, boolean) to authenticated;

create or replace function public.admin_nix_lessons(p_kind text)
returns text language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  return btrim(sc_nix_lessons_text(p_kind, 8), E'\n');
end $$;
revoke all on function public.admin_nix_lessons(text) from public, anon;
grant execute on function public.admin_nix_lessons(text) to authenticated;

-- One "right / wrong" count per job for the scoreboard, final say included.
do $$
declare d text := pg_get_functiondef('public.admin_nix_jobs_progress'::regproc);
begin
  d := replace(d, '''making'', case',
    '''right'', case when k.src = ''suggest'' then (select count(*) from nix_suggestions s where s.kind = k.kind and s.check_verdict = ''agree'')
        else (select count(*) from nix_notes n where n.kind = k.kind and (n.check_verdict = ''agree'' or n.final_side = ''nix'')) end,
      ''wrong'', case when k.src = ''suggest'' then (select count(*) from nix_suggestions s where s.kind = k.kind and s.check_verdict in (''disagree'', ''corrected''))
        else (select count(*) from nix_notes n where n.kind = k.kind and n.check_verdict = ''disagree'' and coalesce(n.final_side, '''') <> ''nix'') end,
      ''making'', case');
  if position('''wrong''' in d) = 0 then raise exception 'progress patch missed'; end if;
  execute d;
end $$;
