-- Settings → Your data → "Reset my collection": empties your collection (to
-- start again, e.g. before a fresh Spotify / Exportify import). A copy is
-- kept for 30 days so it can be put back with one press.
create table if not exists collection_backups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  songs jsonb not null,             -- [{track_id, collected_at}]
  n int not null,
  made_at timestamptz not null default now()
);
alter table collection_backups enable row level security;

create or replace function rpc_reset_my_collection(p_confirm text) returns int
language plpgsql security definer set search_path to 'public' as $$
declare u uuid := auth.uid(); n int;
begin
  if u is null then raise exception 'Log in first.'; end if;
  if lower(trim(coalesce(p_confirm, ''))) <> 'reset' then raise exception 'Type "reset" to confirm.'; end if;
  select count(*) into n from track_ownership where user_id = u;
  if n = 0 then return 0; end if;
  insert into collection_backups (user_id, songs, n, made_at)
  select u, jsonb_agg(jsonb_build_object('track_id', track_id, 'collected_at', collected_at)), count(*), now()
  from track_ownership where user_id = u
  on conflict (user_id) do update set songs = excluded.songs, n = excluded.n, made_at = excluded.made_at;
  delete from track_ownership where user_id = u;
  return n;
end $$;

-- Put the last reset back (songs collected since are kept too).
create or replace function rpc_restore_my_collection() returns int
language plpgsql security definer set search_path to 'public' as $$
declare u uuid := auth.uid(); n int;
begin
  if u is null then raise exception 'Log in first.'; end if;
  insert into track_ownership (user_id, track_id, collected_at)
  select u, x ->> 'track_id', coalesce((x ->> 'collected_at')::timestamptz, now())
  from collection_backups b, jsonb_array_elements(b.songs) x
  where b.user_id = u and b.made_at > now() - interval '30 days'
    and exists (select 1 from tracks t where t.id = x ->> 'track_id')
  on conflict do nothing;
  get diagnostics n = row_count;
  delete from collection_backups where user_id = u;
  return n;
end $$;

create or replace function rpc_my_collection_backup() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('n', n, 'made_at', made_at, 'until', made_at + interval '30 days')
  from collection_backups where user_id = auth.uid() and made_at > now() - interval '30 days';
$$;

revoke execute on function rpc_reset_my_collection(text), rpc_restore_my_collection(), rpc_my_collection_backup() from public, anon;
grant execute on function rpc_reset_my_collection(text), rpc_restore_my_collection(), rpc_my_collection_backup() to authenticated;
