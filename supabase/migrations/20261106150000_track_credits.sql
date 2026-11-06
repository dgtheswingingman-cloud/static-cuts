-- Credit people for every change they make to a song, however they made it
-- (Spotify import, Local Cuts, tracker sheet, suggestion, edit...). Built from
-- the undo history: every change by a signed-in person is in a batch they
-- started. Used for the contributors leaderboard and each song's credits.
create table if not exists track_credits (
  track_id text not null,
  batch_id uuid not null references change_batches(id) on delete cascade,
  user_id uuid not null,
  kind text not null check (kind in ('added', 'edited')),
  fields text[] not null default '{}',
  at timestamptz not null default now(),
  primary key (track_id, batch_id, kind)
);
create index if not exists track_credits_user_idx on track_credits (user_id, at desc);
alter table track_credits enable row level security;

-- Columns that change without anyone editing anything meaningful.
create or replace function sc_credit_fields(p_old jsonb, p_new jsonb)
returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(coalesce(p_new, '{}')) k
  where p_new -> k is distinct from p_old -> k
    and k not in ('id', 'artist_id', 'created_at', 'updated_at', 'search_text', 'title_key')
    and k !~ '(_at|_claim|_claimed|_checked|_attempted|_verified|_index)$';
$$;

create or replace function sc_track_credit_capture()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into track_credits (track_id, batch_id, user_id, kind, fields, at)
  select x.track_id, x.batch_id, x.user_id, x.kind, x.fields, x.at from (
    select coalesce(n.new_row ->> 'id', n.old_row ->> 'id') track_id, n.batch_id, b.created_by user_id,
           case when n.op = 'INSERT' then 'added' else 'edited' end kind,
           case when n.op = 'INSERT' then '{}'::text[] else sc_credit_fields(n.old_row, n.new_row) end fields,
           coalesce(n.created_at, now()) at
    from new_rows n join change_batches b on b.id = n.batch_id
    where n.table_name = 'tracks' and n.op in ('INSERT', 'UPDATE') and b.created_by is not null
  ) x
  where x.track_id is not null and (x.kind = 'added' or cardinality(x.fields) > 0)
  on conflict (track_id, batch_id, kind) do update
    set fields = (select coalesce(array_agg(distinct f order by f), '{}') from unnest(track_credits.fields || excluded.fields) f);
  return null;
end $$;
drop trigger if exists change_log_track_credits on change_log;
create trigger change_log_track_credits after insert on change_log
  referencing new table as new_rows for each statement execute function sc_track_credit_capture();

-- Fill in from the history kept so far, a few batches every 2 minutes.
create table if not exists track_credits_backfilled (batch_id uuid primary key);
alter table track_credits_backfilled enable row level security;
create or replace function sc_track_credits_backfill_step(p_batches int default 15)
returns int language plpgsql security definer set search_path to 'public' set statement_timeout to '240s' as $$
declare b uuid; n int := 0; m int;
begin
  for b in select cb.id from change_batches cb
           where cb.created_by is not null
             and not exists (select 1 from track_credits_backfilled d where d.batch_id = cb.id)
           order by cb.created_at desc limit p_batches loop
    insert into track_credits (track_id, batch_id, user_id, kind, fields, at)
    select x.track_id, x.batch_id, x.user_id, x.kind,
           (select coalesce(array_agg(distinct f order by f), '{}') from unnest(x.fields) f), x.at
    from (
      select coalesce(c.new_row ->> 'id', c.old_row ->> 'id') track_id, c.batch_id, cb.created_by user_id,
             case when c.op = 'INSERT' then 'added' else 'edited' end kind,
             coalesce(array_agg(f) filter (where f is not null), '{}') fields, min(coalesce(c.created_at, cb.created_at)) at
      from change_log c join change_batches cb on cb.id = c.batch_id
      left join lateral unnest(case when c.op = 'UPDATE' then sc_credit_fields(c.old_row, c.new_row) end) f on true
      where c.batch_id = b and c.table_name = 'tracks' and c.op in ('INSERT', 'UPDATE')
      group by 1, 2, 3, 4
    ) x
    where x.track_id is not null and (x.kind = 'added' or cardinality(x.fields) > 0)
    on conflict do nothing;
    get diagnostics m = row_count;
    n := n + m;
    insert into track_credits_backfilled values (b) on conflict do nothing;
  end loop;
  if not exists (select 1 from change_batches cb where cb.created_by is not null
                 and not exists (select 1 from track_credits_backfilled d where d.batch_id = cb.id)) then
    perform cron.unschedule('track-credits-backfill');
  end if;
  return n;
end $$;
revoke execute on function sc_track_credits_backfill_step(int) from public, anon, authenticated;
select cron.schedule('track-credits-backfill', '*/2 * * * *', 'select public.sc_track_credits_backfill_step(15)');

-- Contributions now include songs added and details filled by any method.
create or replace function sc_contribution_events(p_user uuid default null, p_since timestamptz default null)
returns table (user_id uuid, kind text, at timestamptz, track_id text, title text, artist_id text)
language sql stable security definer set search_path to 'public' as $$
  select t.added_by,
         case when t.parent_track_id is null then 'song' else 'version' end,
         coalesce(t.created_at, now()), t.id, t.title, t.artist_id
  from tracks t
  where t.added_by is not null and (p_user is null or t.added_by = p_user)
    and (p_since is null or t.created_at >= p_since)
  union all
  select s.submitted_by,
         case when s.type = 'status_change' then 'status' else 'correction' end,
         coalesce(s.reviewed_at, s.created_at), nullif(s.payload ->> 'track_id', ''),
         coalesce(s.payload ->> 'track_title', s.payload ->> 'title', (select title from tracks where id = s.payload ->> 'track_id')),
         s.artist_id
  from submissions s
  where s.status = 'approved' and s.type in ('status_change', 'correction', 'flag_link', 'flag_deletion')
    and (p_user is null or s.submitted_by = p_user)
    and (p_since is null or coalesce(s.reviewed_at, s.created_at) >= p_since)
  union all
  select e.user_id,
         case when e.user_id = d.first_seen_by then 'find' else 'confirmation' end,
         coalesce(d.reviewed_at, e.created_at), d.matched_track_id,
         d.title || coalesce(' (' || d.version_hint || ')', ''), coalesce(d.main_artist_id, d.artist_id)
  from discovery_evidence e join discoveries d on d.id = e.discovery_id
  where d.state = 'promoted'
    and (p_user is null or e.user_id = p_user)
    and (p_since is null or coalesce(d.reviewed_at, e.created_at) >= p_since)
    and not (e.user_id = d.first_seen_by and exists (
      select 1 from submissions s join tracks t on t.id = s.resulting_id
      where s.id = d.submission_id and t.added_by = e.user_id))
  union all
  -- Songs added through an import (Spotify, files, sheets...), still on the site.
  select c.user_id, case when t.parent_track_id is null then 'import_song' else 'import_version' end,
         c.at, t.id, t.title, t.artist_id
  from track_credits c join tracks t on t.id = c.track_id join change_batches b on b.id = c.batch_id
  where c.kind = 'added' and b.undone_at is null and t.added_by is distinct from c.user_id
    and (p_user is null or c.user_id = p_user) and (p_since is null or c.at >= p_since)
  union all
  -- Details filled in or fixed on songs someone else added: once per song.
  select x.user_id, 'detail', x.at, t.id, t.title, t.artist_id
  from (select distinct on (c.user_id, c.track_id) c.user_id, c.track_id, c.at
        from track_credits c join change_batches b on b.id = c.batch_id
        where c.kind = 'edited' and b.undone_at is null
          and (p_user is null or c.user_id = p_user) and (p_since is null or c.at >= p_since)
          and not exists (select 1 from track_credits a where a.track_id = c.track_id and a.user_id = c.user_id and a.kind = 'added')
        order by c.user_id, c.track_id, c.at) x
  join tracks t on t.id = x.track_id
  where t.added_by is distinct from x.user_id;
$$;

-- Points: songs you add by hand 10, versions 5, finds 8, status 4, fixes 3,
-- confirmations 2; songs from imports 3, versions from imports 2, details 1.
do $do$
declare d text;
begin
  d := pg_get_functiondef('sc_refresh_leaderboard'::regproc);
  d := replace(d, 'when ''correction'' then 3 when ''confirmation'' then 2 else 0 end) as points,',
                  'when ''correction'' then 3 when ''confirmation'' then 2 when ''import_song'' then 3 when ''import_version'' then 2 when ''detail'' then 1 else 0 end) as points,');
  d := replace(d, 'count(*) filter (where ev.kind = ''song'') songs, count(*) filter (where ev.kind = ''version'') versions,',
                  'count(*) filter (where ev.kind in (''song'', ''import_song'')) songs, count(*) filter (where ev.kind in (''version'', ''import_version'')) versions,');
  d := replace(d, 'count(*) filter (where ev.kind = ''correction'') corrections,',
                  'count(*) filter (where ev.kind in (''correction'', ''detail'')) corrections,');
  if position('import_song' in d) = 0 or position('''detail''))' in d) = 0 then raise exception 'leaderboard patch failed'; end if;
  execute d;
  d := pg_get_functiondef('rpc_top_contributors'::regproc);
  d := replace(d, 'count(*) filter (where e.kind = ''song''), count(*) filter (where e.kind = ''version''),',
                  'count(*) filter (where e.kind in (''song'', ''import_song'')), count(*) filter (where e.kind in (''version'', ''import_version'')),');
  d := replace(d, 'count(*) filter (where e.kind = ''correction''),', 'count(*) filter (where e.kind in (''correction'', ''detail'')),');
  if position('import_song' in d) = 0 then raise exception 'top patch failed'; end if;
  execute d;
end $do$;

-- A song's credits: who added it, who's edited it (and what), and where its
-- details came from. People who hide their contributions show as "a contributor".
create or replace function rpc_song_credits(p_track text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with t as (select * from tracks where id = p_track),
  people as (
    select c.user_id, c.kind, c.fields, c.at, b.kind via, b.label
    from track_credits c join change_batches b on b.id = c.batch_id
    where c.track_id = p_track and b.undone_at is null
  ),
  who as (
    select u.user_id, case when sc_contributions_visible(u.user_id) then p.display_name end name,
           case when sc_contributions_visible(u.user_id) then p.avatar_url end avatar
    from (select distinct user_id from people union select added_by from t where added_by is not null) u
    left join profiles p on p.id = u.user_id
  ),
  first_add as (
    select coalesce((select added_by from t), (select user_id from people where kind = 'added' order by at limit 1)) user_id,
           coalesce((select via from people where kind = 'added' order by at limit 1), case when (select added_by from t) is not null then 'suggestion' end) via,
           (select label from people where kind = 'added' order by at limit 1) label
  )
  select jsonb_build_object(
    'added_at', (select created_at from t),
    'added_by', (select case when f.user_id is null then null else jsonb_build_object('id', case when w.name is not null then f.user_id end, 'name', coalesce(w.name, 'a contributor'), 'avatar', w.avatar, 'via', f.via, 'label', f.label) end
                 from first_add f left join who w on w.user_id = f.user_id),
    'source', (select source from t),
    'sheet', (select s.title from sheet_sources s, t where t.source = 'sheet' and s.url = t.source_url limit 1),
    'editors', (select coalesce(jsonb_agg(e order by e.last desc), '[]'::jsonb) from (
        select case when w.name is not null then x.user_id end id, coalesce(w.name, 'a contributor') name, w.avatar,
               count(*) edits, max(x.at) last,
               (select coalesce(array_agg(distinct f), '{}') from people y, unnest(y.fields) f where y.user_id = x.user_id and y.kind = 'edited') fields
        from people x left join who w on w.user_id = x.user_id
        where x.kind = 'edited' and x.user_id is distinct from (select user_id from first_add)
        group by x.user_id, w.name, w.avatar) e),
    'details_from', (select array_remove(array[
        case when spotify_url is not null then 'Spotify' end,
        case when deezer_url is not null then 'Deezer' end,
        case when apple_url is not null then 'Apple Music' end,
        case when genius_song_id is not null then 'Genius' end,
        case when source = 'lastfm' then 'Last.fm' end,
        case when source = 'sheet' then 'a community tracker' end], null) from t)
  );
$$;
grant execute on function rpc_song_credits(text) to anon, authenticated;

select sc_refresh_leaderboard();
