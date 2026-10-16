-- Lets the admin set a track's release status from the artist page's edit
-- and add-track forms (rumored, teased, snippet, leaked, announced,
-- released, removed). is_official follows automatically, and the change is
-- logged in track_status_events.

create or replace function public.admin_set_release_status(p_track_id text, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('rumored', 'teased', 'snippet', 'leaked', 'announced', 'released', 'removed') then
    raise exception 'unknown status %', p_status;
  end if;
  update tracks set release_status = p_status
  where id = p_track_id and release_status is distinct from p_status;
end;
$$;

revoke all on function public.admin_set_release_status(text, text) from public, anon;
grant execute on function public.admin_set_release_status(text, text) to authenticated;
