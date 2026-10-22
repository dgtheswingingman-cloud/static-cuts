-- Imported songs: see the ones that were dismissed (newest first) and put
-- any back on the waiting list if they were dismissed by mistake.

create or replace function admin_dismissed_import_suggestions(p_limit integer default 2000)
returns table(id uuid, artist_id text, artist_name text, source text, title text, status_guess text, url text,
              release_date date, main_artist_name text, extra jsonb, decided_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.id, s.artist_id, a.name, s.source, s.title, s.status_guess, s.url, s.release_date, s.main_artist_name, s.extra, s.decided_at
  from import_suggestions s join artists a on a.id = s.artist_id
  where is_moderator() and s.state = 'dismissed'
  order by s.decided_at desc nulls last, a.name, s.title
  limit greatest(1, least(coalesce(p_limit, 2000), 5000));
$$;
revoke execute on function admin_dismissed_import_suggestions(integer) from public, anon;
grant execute on function admin_dismissed_import_suggestions(integer) to authenticated;

create or replace function admin_restore_import_suggestions(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n int;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  update import_suggestions set state = 'open', decided_at = null where id = any (p_ids) and state = 'dismissed';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function admin_restore_import_suggestions(uuid[]) from public, anon;
grant execute on function admin_restore_import_suggestions(uuid[]) to authenticated;
