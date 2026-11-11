-- Static Cuts codes: a short, fixed code for every song and version, e.g.
-- SC-KANY-000935. Ours, not an ISRC (those are only issued to a recording's
-- owner): the letters are the artist (as they were when the code was made),
-- the number is unique across the site and never reused. Kept in its own
-- table so making them doesn't touch (or log) every song row.

create sequence if not exists public.track_code_seq;

create table if not exists public.track_codes (
  track_id text primary key references public.tracks(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists track_codes_num on public.track_codes (split_part(code, '-', 3));
alter table public.track_codes enable row level security;
drop policy if exists track_codes_read on public.track_codes;
create policy track_codes_read on public.track_codes for select using (true);

create or replace function public.sc_code_prefix(p_name text) returns text language sql immutable as $$
  select rpad(left(upper(regexp_replace(translate(coalesce(p_name, ''), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöøùúûüý', 'AAAAAACEEEEIIIINOOOOOOUUUUYaaaaaaceeeeiiiinoooooouuuuy'), '[^A-Za-z0-9]', '', 'g')), 4), 4, 'X')
$$;

-- The number part: at least 6 digits (more once there are a million songs).
create or replace function public.sc_code_num(n bigint) returns text language sql immutable as $$
  select case when n < 1000000 then lpad(n::text, 6, '0') else n::text end
$$;

create or replace function public.sc_track_code_new() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into track_codes (track_id, code)
  values (new.id, 'SC-' || sc_code_prefix((select name from artists where id = new.artist_id)) || '-' || sc_code_num(nextval('track_code_seq')))
  on conflict (track_id) do nothing;
  return null;
end $$;
drop trigger if exists tracks_code_new on public.tracks;
create trigger tracks_code_new after insert on public.tracks for each row execute function sc_track_code_new();

-- Find a song by its code (any case; the dashes and letters are optional:
-- "sc-kany-935", "SC935" and "935" with the SC all work).
create or replace function public.rpc_track_by_code(p_code text) returns text
language sql stable security definer set search_path to 'public' as $$
  select track_id from track_codes
  where code = upper(trim(p_code))
     or split_part(code, '-', 3) = sc_code_num(nullif(substring(upper(p_code) from '^\s*SC[-\s]*(?:(?=[A-Z0-9]{0,3}[A-Z])[A-Z0-9]{4}[-\s]*)?(\d{1,9})\s*$'), '')::bigint)
  order by code = upper(trim(p_code)) desc limit 1;
$$;
grant execute on function public.rpc_track_by_code(text) to anon, authenticated;

-- Codes for every song already here, oldest first.
insert into public.track_codes (track_id, code)
select t.id, 'SC-' || public.sc_code_prefix(a.name) || '-' || public.sc_code_num(nextval('public.track_code_seq'))
from (select id, artist_id from public.tracks order by created_at, id) t left join public.artists a on a.id = t.artist_id
on conflict (track_id) do nothing;
