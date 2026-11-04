-- Song timelines: real-world moments in a song's life (first snippet on an
-- IG live, played at a show, teased in an interview, leaked, released,
-- music video), each with a date and a source link. Anyone signed in can
-- add one; it shows straight away with who added it; moderators (and the
-- person who added it) can take it down. Shown on the song page with the
-- release/leak dates and the site's own status changes. Source links can't
-- be file hosts or audio files: a timeline says where something happened,
-- never where to get it.

create table if not exists song_moments (
  id uuid primary key default gen_random_uuid(),
  track_id text not null,
  kind text not null check (kind in ('snippet', 'live', 'show', 'interview', 'tease', 'leak', 'release', 'video', 'other')),
  happened_on date not null,
  precision text not null default 'day' check (precision in ('day', 'month', 'year')),
  title text not null,
  source_url text not null,
  added_by uuid,
  removed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists song_moments_track on song_moments (track_id) where not removed;
alter table song_moments enable row level security;
create policy "Public can read song moments" on song_moments for select using (not removed);

create or replace function rpc_song_moments(p_track text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'kind', m.kind, 'happened_on', m.happened_on, 'precision', m.precision, 'title', m.title,
    'source_url', m.source_url, 'added_by', m.added_by, 'by_name', p.display_name,
    'mine', m.added_by = auth.uid()) order by m.happened_on, m.created_at), '[]'::jsonb)
  from song_moments m left join profiles p on p.id = m.added_by
  where m.track_id = p_track and not m.removed;
$$;
grant execute on function rpc_song_moments(text) to anon, authenticated;

create or replace function rpc_song_moment_add(p_track text, p_kind text, p_date date, p_precision text, p_title text, p_source text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); v_id uuid; v_title text := nullif(trim(coalesce(p_title, '')), ''); v_src text := trim(coalesce(p_source, ''));
begin
  if me is null then raise exception 'Sign in to add a moment.'; end if;
  if not exists (select 1 from tracks where id = p_track) then raise exception 'unknown song'; end if;
  if p_kind not in ('snippet', 'live', 'show', 'interview', 'tease', 'leak', 'release', 'video', 'other') then raise exception 'Pick what kind of moment it was.'; end if;
  if p_date is null or p_date > current_date + 1 or p_date < date '1950-01-01' then raise exception 'Pick a date (not in the future).'; end if;
  if v_title is null or length(v_title) > 200 then raise exception 'Say what happened (200 characters max).'; end if;
  if v_src !~* '^https?://[^ ]+\.[^ ]+' or length(v_src) > 500 then raise exception 'Add a link to where this is shown (a post, video or article).'; end if;
  -- Sources say where it happened, never where to get the audio.
  if v_src ~* '(mega\.nz|mediafire|krakenfiles|pixeldrain|catbox\.moe|gofile|dropbox|drive\.google|docs\.google|anonfiles|zippyshare|we\.tl|wetransfer|pillowcase|bunkr|sendspace|filebin|files\.fm|uploadhaven|\.(mp3|m4a|wav|flac|aac|ogg|zip|rar)(\?|$))' then
    raise exception 'Link to a post, video or article about it, not to a file.';
  end if;
  if (select count(*) from song_moments where added_by = me and created_at > now() - interval '1 day') >= 40 then
    raise exception 'That''s plenty for today. Try again tomorrow.';
  end if;
  if exists (select 1 from song_moments where track_id = p_track and not removed and lower(source_url) = lower(v_src) and kind = p_kind) then
    raise exception 'That moment is already on the timeline.';
  end if;
  insert into song_moments (track_id, kind, happened_on, precision, title, source_url, added_by)
  values (p_track, p_kind, p_date, coalesce(nullif(p_precision, ''), 'day'), v_title, v_src, me)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function rpc_song_moment_add(text, text, date, text, text, text) to authenticated;

create or replace function rpc_song_moment_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (is_moderator() or exists (select 1 from song_moments where id = p_id and added_by = auth.uid())) then raise exception 'not authorized'; end if;
  update song_moments set removed = true where id = p_id;
end;
$$;
grant execute on function rpc_song_moment_remove(uuid) to authenticated;
