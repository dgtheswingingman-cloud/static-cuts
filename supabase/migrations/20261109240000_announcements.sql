-- Shows, tours and merch drops (9 Nov 2026).
--
-- Reported by the ChatGPT connector (submit_announcement) or the daily check,
-- with a source link. Trusted contributors' go live straight away (like
-- their finds); others wait on /review/announcements. Artist pages show
-- what's coming up: shows and tours from today on, merch drops from the last
-- 30 days and upcoming. No ticket or store buttons: just the source link.

create table if not exists artist_announcements (
  id uuid primary key default gen_random_uuid(),
  artist_id text not null references artists(id) on delete cascade,
  kind text not null check (kind in ('show', 'tour', 'festival', 'merch')),
  title text not null,
  starts_on date,
  ends_on date,
  venue text,
  city text,
  country text,
  source_url text not null,
  notes text,
  state text not null default 'open' check (state in ('open', 'approved', 'dismissed')),
  submitted_by uuid,
  created_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz
);
create unique index if not exists artist_announcements_once
  on artist_announcements (artist_id, kind, lower(title), coalesce(starts_on, '1900-01-01'::date), lower(coalesce(city, '')));
create index if not exists artist_announcements_artist_idx on artist_announcements (artist_id, state, starts_on);
alter table artist_announcements enable row level security;

create or replace function rpc_submit_announcement(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  uid uuid := auth.uid();
  v_kind text := lower(coalesce(p ->> 'kind', ''));
  v_title text := left(nullif(trim(p ->> 'title'), ''), 200);
  v_url text := nullif(trim(p ->> 'source_url'), '');
  v_start date; v_end date;
  v_state text;
  v_id uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from artists where id = p ->> 'artist_id') then raise exception 'unknown artist_id'; end if;
  if v_kind not in ('show', 'tour', 'festival', 'merch') then raise exception 'kind must be show, tour, festival or merch'; end if;
  if v_title is null then raise exception 'title is required'; end if;
  if v_url is null or v_url !~* '^https?://' then raise exception 'source_url (http/https) is required'; end if;
  begin v_start := nullif(p ->> 'starts_on', '')::date; exception when others then v_start := null; end;
  begin v_end := nullif(p ->> 'ends_on', '')::date; exception when others then v_end := null; end;
  v_state := case when is_owner() or is_moderator() or sc_is_trusted(uid) then 'approved' else 'open' end;
  insert into artist_announcements (artist_id, kind, title, starts_on, ends_on, venue, city, country, source_url, notes, state, submitted_by,
                                    reviewed_by, reviewed_at)
  values (p ->> 'artist_id', v_kind, v_title, v_start, v_end, left(nullif(trim(p ->> 'venue'), ''), 200),
          left(nullif(trim(p ->> 'city'), ''), 120), left(nullif(trim(p ->> 'country'), ''), 80), left(v_url, 1000),
          left(nullif(trim(p ->> 'notes'), ''), 1000), v_state, uid,
          case when v_state = 'approved' then uid end, case when v_state = 'approved' then now() end)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', true, 'sent', false, 'note', 'Already on Static Cuts.');
  end if;
  return jsonb_build_object('ok', true, 'sent', true, 'live', v_state = 'approved');
end $function$;
revoke execute on function rpc_submit_announcement(jsonb) from public, anon;
grant execute on function rpc_submit_announcement(jsonb) to authenticated;

-- Artist page: what's coming up.
create or replace function rpc_artist_announcements(p_artist text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'starts_on', x.starts_on, 'ends_on', x.ends_on,
           'venue', x.venue, 'city', x.city, 'country', x.country, 'url', x.source_url)
         order by x.starts_on nulls last, x.created_at desc), '[]'::jsonb)
  from (
    select * from artist_announcements a
    where a.artist_id = p_artist and a.state = 'approved'
      and case when a.kind = 'merch'
               then coalesce(a.starts_on, a.created_at::date) >= current_date - 30
               else coalesce(a.ends_on, a.starts_on, a.created_at::date + 60) >= current_date end
    order by a.starts_on nulls last limit 40
  ) x;
$function$;
grant execute on function rpc_artist_announcements(text) to anon, authenticated;

-- Moderators.
create or replace function admin_announcements(p_state text default 'open')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'counts', (select jsonb_object_agg(state, n) from (select state, count(*) n from artist_announcements group by 1) c),
    'items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) from (
      select a.*, ar.name artist, (select display_name from profiles where id = a.submitted_by) by_name
      from artist_announcements a join artists ar on ar.id = a.artist_id
      where a.state = coalesce(p_state, 'open') order by a.created_at desc limit 300) x));
end $function$;
revoke execute on function admin_announcements(text) from public, anon;
grant execute on function admin_announcements(text) to authenticated;

create or replace function admin_announcement_action(p_ids uuid[], p_action text)
returns int language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_action not in ('approve', 'dismiss') then raise exception 'unknown action'; end if;
  update artist_announcements set state = case p_action when 'approve' then 'approved' else 'dismissed' end,
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end $function$;
revoke execute on function admin_announcement_action(uuid[], text) from public, anon;
grant execute on function admin_announcement_action(uuid[], text) to authenticated;
