-- Title checks (admins): rule-based checks over the whole catalogue, no AI.
--   cut      titles cut off at 28-30 characters mid-word (old MP3 tags cap
--            titles at 30; nearly all came in from Last.fm), where the same
--            artist has the full-title song: merge into it, or "not the same".
--   garbled  broken characters (Youâ€™re), leftover HTML (Isn&apos;t) and
--            stray spaces, each with a safe automatic fix. Titles the fixer
--            can't repair for certain are left out, not guessed.
-- Nothing changes without an admin; fixes and merges are in Undo.

create table if not exists title_check_dismissed (
  track_id text not null references tracks(id) on delete cascade,
  kind text not null check (kind in ('cut', 'garbled')),
  dismissed_by uuid default auth.uid(),
  dismissed_at timestamptz not null default now(),
  primary key (track_id, kind)
);
alter table title_check_dismissed enable row level security;

-- The fix for a garbled title, or the title unchanged if there's no safe one.
create or replace function sc_fixed_title(t text)
returns text
language plpgsql
immutable
as $$
declare s text := t; prev text;
begin
  -- HTML entities, including doubled ones (&amp;amp;apos;).
  loop
    prev := s;
    s := replace(s, '&amp;', '&');
    exit when s = prev;
  end loop;
  s := replace(replace(replace(replace(replace(replace(s, '&apos;', ''''), '&#39;', ''''), '&quot;', '"'), '&lt;', '<'), '&gt;', '>'), '&#x27;', '''');
  -- UTF-8 read as Windows-1252 (Youâ€™re -> You’re). Only when converting
  -- back gives valid text; otherwise left as it is.
  if s ~ '(Ã|â€|Â)' then
    begin
      s := convert_from(convert_to(s, 'WIN1252'), 'UTF8');
    exception when others then
      return case when s = t then t else btrim(regexp_replace(s, '\s{2,}', ' ', 'g')) end;
    end;
  end if;
  s := replace(s, chr(160), ' ');
  return btrim(regexp_replace(s, '\s{2,}', ' ', 'g'));
end $$;

create or replace function admin_title_checks()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  with cut as (
    select t.id, t.title, t.artist_id, t.release_status status
    from tracks t
    where char_length(t.title) between 28 and 30 and right(t.title, 1) ~ '[[:alnum:]]'
      and not exists (select 1 from title_check_dismissed d where d.track_id = t.id and d.kind = 'cut')),
  cut_full as (
    select c.*, a.name artist,
      (select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'status', o.release_status) order by char_length(o.title), o.title)
       from (select o.* from tracks o
             where o.artist_id = c.artist_id and o.id <> c.id and char_length(o.title) > char_length(c.title)
               and lower(left(o.title, char_length(c.title))) = lower(c.title)
               and substr(o.title, char_length(c.title) + 1, 1) ~ '[[:alnum:]]'
             order by char_length(o.title) limit 3) o) candidates
    from cut c join artists a on a.id = c.artist_id),
  garbled as (
    select t.id, t.title, sc_fixed_title(t.title) fixed, t.artist_id, a.name artist
    from tracks t join artists a on a.id = t.artist_id
    -- (Titles whose only problem is an invisible non-breaking space aren't
    -- listed; that's fixed along with anything else.)
    where (t.title ~ '(Ã|â€|Â|&(amp|apos|quot|lt|gt|#39|#x27);)' or t.title ~ '^\s|\s$|\s{2,}')
      and not exists (select 1 from title_check_dismissed d where d.track_id = t.id and d.kind = 'garbled'))
  select case when not is_admin() then null else jsonb_build_object(
    'cut', coalesce((select jsonb_agg(to_jsonb(x) order by x.artist, x.title) from cut_full x where x.candidates is not null), '[]'::jsonb),
    'garbled', coalesce((select jsonb_agg(to_jsonb(g) order by g.artist, g.title) from garbled g where g.fixed <> g.title and g.fixed <> ''), '[]'::jsonb)) end;
$$;

-- cut: 'merge' into p_target (one of the full-title songs) or 'dismiss'.
-- garbled: 'fix' (the title becomes sc_fixed_title) or 'dismiss'.
create or replace function admin_title_check_action(p_track text, p_kind text, p_action text, p_target text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_title text; v_fixed text;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_action = 'dismiss' then
    insert into title_check_dismissed (track_id, kind) values (p_track, p_kind) on conflict do nothing;
    return 'dismissed';
  end if;
  if p_kind = 'cut' and p_action = 'merge' then
    if p_target is null or not exists (select 1 from tracks a join tracks b on b.artist_id = a.artist_id where a.id = p_track and b.id = p_target) then
      raise exception 'Pick a full-title song by the same artist.';
    end if;
    perform admin_merge_duplicates(p_target, array[p_track]);
    return 'merged';
  end if;
  if p_kind = 'garbled' and p_action = 'fix' then
    select title into v_title from tracks where id = p_track;
    if v_title is null then raise exception 'That song is gone.'; end if;
    v_fixed := sc_fixed_title(v_title);
    if v_fixed = v_title or v_fixed = '' then return 'unchanged'; end if;
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('titles', left('Title fixed: ' || v_fixed, 200));
    update tracks set title = v_fixed where id = p_track;
    return 'fixed';
  end if;
  raise exception 'unknown action';
end $$;

revoke all on table title_check_dismissed from anon, authenticated;
revoke execute on function admin_title_checks() from public, anon;
revoke execute on function admin_title_check_action(text, text, text, text) from public, anon;
grant execute on function admin_title_checks() to authenticated;
grant execute on function admin_title_check_action(text, text, text, text) to authenticated;

-- Finding the full-title songs takes ~15 seconds over the whole catalogue,
-- too slow for a page. So the checks run nightly into title_check_found and
-- the page reads that; acting on a row removes it straight away.
create table if not exists title_check_found (
  track_id text not null references tracks(id) on delete cascade,
  kind text not null check (kind in ('cut', 'garbled')),
  title text not null,             -- the title when it was found (stale if it's changed since)
  payload jsonb not null,          -- cut: {candidates}; garbled: {fixed}
  found_at timestamptz not null default now(),
  primary key (track_id, kind)
);
alter table title_check_found enable row level security;
revoke all on table title_check_found from anon, authenticated;

create or replace function sc_title_checks_refresh()
returns int
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '120s'
as $$
declare n int;
begin
  delete from title_check_found;
  insert into title_check_found (track_id, kind, title, payload)
  select c.id, 'cut', c.title, jsonb_build_object('candidates', cand.list)
  from tracks c
  cross join lateral (
    select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'status', o.release_status) order by char_length(o.title), o.title) list
    from (select o.* from tracks o
          where o.artist_id = c.artist_id and o.id <> c.id and char_length(o.title) > char_length(c.title)
            and lower(left(o.title, char_length(c.title))) = lower(c.title)
            and substr(o.title, char_length(c.title) + 1, 1) ~ '[[:alnum:]]'
          order by char_length(o.title) limit 3) o) cand
  where char_length(c.title) between 28 and 30 and right(c.title, 1) ~ '[[:alnum:]]' and cand.list is not null;
  insert into title_check_found (track_id, kind, title, payload)
  select t.id, 'garbled', t.title, jsonb_build_object('fixed', sc_fixed_title(t.title))
  from tracks t
  where (t.title ~ '(Ã|â€|Â|&(amp|apos|quot|lt|gt|#39|#x27);)' or t.title ~ '^\s|\s$|\s{2,}')
    and sc_fixed_title(t.title) not in (t.title, '');
  select count(*) into n from title_check_found;
  return n;
end $$;
revoke execute on function sc_title_checks_refresh() from public, anon, authenticated;

create or replace function admin_title_checks()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  with live as (
    select f.*, t.artist_id, a.name artist, t.release_status status
    from title_check_found f join tracks t on t.id = f.track_id and t.title = f.title join artists a on a.id = t.artist_id
    where not exists (select 1 from title_check_dismissed d where d.track_id = f.track_id and d.kind = f.kind))
  select case when not is_admin() then null else jsonb_build_object(
    'cut', coalesce((select jsonb_agg(jsonb_build_object('id', track_id, 'title', title, 'artist_id', artist_id, 'artist', artist, 'status', status,
                     'candidates', payload->'candidates') order by artist, title) from live where kind = 'cut'), '[]'::jsonb),
    'garbled', coalesce((select jsonb_agg(jsonb_build_object('id', track_id, 'title', title, 'artist_id', artist_id, 'artist', artist,
                     'fixed', payload->>'fixed') order by artist, title) from live where kind = 'garbled'), '[]'::jsonb),
    'checked_at', (select max(found_at) from title_check_found)) end;
$$;

select cron.schedule('title-checks', '23 4 * * *', $c$ select public.sc_title_checks_refresh(); $c$);

create or replace function admin_title_check_action(p_track text, p_kind text, p_action text, p_target text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_title text; v_fixed text;
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  delete from title_check_found where track_id = p_track and kind = p_kind;
  if p_action = 'dismiss' then
    insert into title_check_dismissed (track_id, kind) values (p_track, p_kind) on conflict do nothing;
    return 'dismissed';
  end if;
  if p_kind = 'cut' and p_action = 'merge' then
    if p_target is null or not exists (select 1 from tracks a join tracks b on b.artist_id = a.artist_id where a.id = p_track and b.id = p_target) then
      raise exception 'Pick a full-title song by the same artist.';
    end if;
    perform admin_merge_duplicates(p_target, array[p_track]);
    return 'merged';
  end if;
  if p_kind = 'garbled' and p_action = 'fix' then
    select title into v_title from tracks where id = p_track;
    if v_title is null then raise exception 'That song is gone.'; end if;
    v_fixed := sc_fixed_title(v_title);
    if v_fixed = v_title or v_fixed = '' then return 'unchanged'; end if;
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('titles', left('Title fixed: ' || v_fixed, 200));
    update tracks set title = v_fixed where id = p_track;
    return 'fixed';
  end if;
  raise exception 'unknown action';
end $$;
