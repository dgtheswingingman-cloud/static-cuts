-- Smarter alerts (premium), on top of instant artist alerts:
-- * per artist: only some kinds (leaks / snippets / releases) and/or only
--   some eras (album / era names);
-- * producer alerts: a new leak, snippet or release a producer is credited
--   on, whoever the artist is.
-- Free accounts keep normal instant alerts (filters are ignored for them).

alter table follows add column if not exists alert_kinds text[];
alter table follows add column if not exists alert_eras text[];

create table if not exists producer_alerts (
  user_id uuid not null references auth.users(id) on delete cascade,
  producer text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, producer)
);
alter table producer_alerts enable row level security;
create index if not exists producer_alerts_producer on producer_alerts (lower(producer));

create or replace function rpc_set_follow_filters(p_artist text, p_kinds text[], p_eras text[]) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare k text[]; e text[];
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  if not is_premium(auth.uid()) then raise exception 'Alert filters are a premium perk.'; end if;
  k := array(select distinct x from unnest(coalesce(p_kinds, '{}')) x where x in ('leaked', 'snippet', 'released'));
  if cardinality(k) = 0 or cardinality(k) = 3 then k := null; end if;
  e := array(select distinct left(trim(x), 200) from unnest(coalesce(p_eras, '{}')) x where nullif(trim(x), '') is not null limit 50);
  if cardinality(e) = 0 then e := null; end if;
  update follows set alert_kinds = k, alert_eras = e where user_id = auth.uid() and artist_id = p_artist;
  return jsonb_build_object('kinds', k, 'eras', e);
end $$;

create or replace function rpc_producer_alert(p_producer text, p_on boolean) returns boolean
language plpgsql security definer set search_path to 'public' as $$
declare p text := left(trim(coalesce(p_producer, '')), 120);
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  if length(p) < 2 then raise exception 'Which producer?'; end if;
  if p_on then
    if not is_premium(auth.uid()) then raise exception 'Producer alerts are a premium perk.'; end if;
    if (select count(*) from producer_alerts where user_id = auth.uid()) >= 50 then raise exception 'Up to 50 producers.'; end if;
    insert into producer_alerts (user_id, producer) values (auth.uid(), p) on conflict do nothing;
  else
    delete from producer_alerts where user_id = auth.uid() and lower(producer) = lower(p);
  end if;
  return p_on;
end $$;

create or replace function rpc_my_producer_alerts() returns text[]
language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(producer order by producer), '{}') from producer_alerts where user_id = auth.uid();
$$;

revoke execute on function rpc_set_follow_filters(text, text[], text[]), rpc_producer_alert(text, boolean), rpc_my_producer_alerts() from public, anon;
grant execute on function rpc_set_follow_filters(text, text[], text[]), rpc_producer_alert(text, boolean), rpc_my_producer_alerts() to authenticated;

-- Instant alerts, now with the filters and producer alerts.
create or replace function public.sc_instant_alert(p_track text, p_title text, p_body text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare t record;
begin
  select tr.id, tr.title, tr.artist_id, tr.release_status status, lower(trim(coalesce(tr.album, ''))) era, tr.producers, a.name artist into t
  from tracks tr join artists a on a.id = tr.artist_id where tr.id = p_track and tr.parent_track_id is null;
  if t.id is null then return; end if;
  insert into notifications (user_id, kind, title, body, link, track_id, dedupe_key)
  select f.user_id, 'alert', p_title, p_body, '/song/' || t.id, t.id, 'alert:' || t.id || ':' || p_title
  from follows f
  where f.artist_id = t.artist_id and f.alert = 'instant'
    and ((f.alert_kinds is null and f.alert_eras is null) or not is_premium(f.user_id) or (
          (f.alert_kinds is null or t.status = any (f.alert_kinds))
      and (f.alert_eras is null or t.era = any (select lower(trim(x)) from unnest(f.alert_eras) x))))
    and (select count(*) from notifications n
         where n.user_id = f.user_id and n.kind = 'alert' and n.created_at > now() - interval '1 hour'
           and n.track_id in (select id from tracks where artist_id = t.artist_id)) < 5
  on conflict do nothing;
  -- producer alerts (premium), whoever the artist is
  if t.producers is not null and t.status in ('leaked', 'snippet', 'released') then
    insert into notifications (user_id, kind, title, body, link, track_id, dedupe_key)
    select distinct on (pa.user_id) pa.user_id, 'alert', p_title, coalesce(p_body || ' ', '') || 'Produced by ' || pa.producer || '.',
           '/song/' || t.id, t.id, 'alert:' || t.id || ':' || p_title
    from producer_alerts pa
    where position(lower(pa.producer) in lower(t.producers)) > 0 and is_premium(pa.user_id)
      and (select count(*) from notifications n where n.user_id = pa.user_id and n.kind = 'alert' and n.created_at > now() - interval '1 hour') < 20
    on conflict do nothing;
  end if;
end;
$function$;
