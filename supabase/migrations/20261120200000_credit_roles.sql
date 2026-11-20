-- Producers, labels and songwriters (Nathan, 20 Nov). The Genius import put
-- songs by artists who aren't on the site onto the page they were found from,
-- labelled "Feature on X's song". For producers, labels and songwriters that's
-- wrong: they made, released or wrote the song, they aren't on it.
-- tracks.credit_role says what the page's artist did instead
-- (producer / label / writer); the song still isn't listed as their own.

alter table public.tracks add column if not exists credit_role text
  check (credit_role in ('producer', 'label', 'writer'));

create table if not exists public.artist_credit_roles (
  artist_id text primary key references public.artists(id) on delete cascade,
  role text not null check (role in ('producer', 'label', 'writer')),
  set_at timestamptz not null default now()
);
alter table public.artist_credit_roles enable row level security;
create policy artist_credit_roles_read on public.artist_credit_roles for select using (true);

-- The note on such a song: "Produced for 4KT Quando." and so on.
create or replace function public.sc_credit_note(p_role text, p_main text, p_page text)
returns text language sql immutable set search_path to 'public' as $$
  select case p_role
    when 'producer' then 'Produced for ' || p_main || '.'
    when 'label' then 'A song by ' || p_main || ', released on ' || p_page || '.'
    when 'writer' then 'A song by ' || p_main || ', written by ' || p_page || '.'
  end;
$$;

-- Pages send the role along.
do $patch$
declare d text; n int;
begin
  d := pg_get_functiondef('public.rpc_artist_tracks(text)'::regprocedure);
  n := (length(d) - length(replace(d, $o$'is_featured', t.is_featured, $o$, ''))) / length($o$'is_featured', t.is_featured, $o$);
  if n <> 1 then raise exception 'rpc_artist_tracks: expected 1 match, found %', n; end if;
  execute replace(d, $o$'is_featured', t.is_featured, $o$, $n$'is_featured', t.is_featured, 'credit_role', t.credit_role, $n$);

  d := pg_get_functiondef('public.rpc_song_page(text)'::regprocedure);
  n := (length(d) - length(replace(d, $o$'is_featured', t.is_featured, $o$, ''))) / length($o$'is_featured', t.is_featured, $o$);
  if n <> 1 then raise exception 'rpc_song_page: expected 1 match, found %', n; end if;
  execute replace(d, $o$'is_featured', t.is_featured, $o$, $n$'is_featured', t.is_featured, 'credit_role', t.credit_role, $n$);

  -- Imports: a song found from a producer's / label's / songwriter's page,
  -- whose artist isn't on the site, gets that credit instead of "Feature on".
  d := pg_get_functiondef('public.admin_apply_import_suggestions(uuid[], text)'::regprocedure);
  if position('insert into _sc_apply_known values (s.artist_id, sc_title_key(s.title))' in d) = 0 then
    raise exception 'admin_apply_import_suggestions: anchor not found';
  end if;
  execute replace(d, 'insert into _sc_apply_known values (s.artist_id, sc_title_key(s.title))',
    $n$if v_main is null and s.main_artist_name is not null then
      update tracks t set credit_role = r.role,
        notes = sc_credit_note(r.role, s.main_artist_name, (select name from artists where id = s.artist_id)),
        producers = case when r.role = 'producer' and position(lower((select name from artists where id = s.artist_id)) in lower(coalesce(t.producers, ''))) = 0
                         then nullif(trim(both ', ' from coalesce(t.producers, '') || ', ' || (select name from artists where id = s.artist_id)), '')
                         else t.producers end
      from artist_credit_roles r where t.id = v_id and r.artist_id = s.artist_id;
    end if;
    insert into _sc_apply_known values (s.artist_id, sc_title_key(s.title))$n$);
end $patch$;
