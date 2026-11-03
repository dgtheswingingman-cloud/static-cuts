-- Fan badges: pick artists you're a fan of and a short tag (CRT, LNLY, DGTL)
-- shows next to your name around the site, linking to their page. One for
-- everyone; up to 3 with premium. Tags are made from the artist's name; the
-- owner can set a better one per artist (artists.tag).

alter table artists add column if not exists tag text;
alter table profiles add column if not exists fan_artists text[] not null default '{}';

-- A short tag from a name: the last word without vowels (first letter kept),
-- doubles squashed, 4 characters at most.
create or replace function sc_artist_tag(p_name text)
returns text
language plpgsql
immutable
as $$
declare w text[]; base text; r text;
begin
  w := array_remove(regexp_split_to_array(upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9 ]', '', 'g')), '\s+'), '');
  if coalesce(array_length(w, 1), 0) = 0 then return null; end if;
  base := w[array_length(w, 1)];
  if length(base) <= 4 and array_length(w, 1) = 1 then return base; end if;
  r := regexp_replace(left(base, 1) || regexp_replace(substr(base, 2), '[AEIOU]', '', 'g'), '(.)\1+', '\1', 'g');
  if length(r) < 3 then
    r := regexp_replace(left(w[1], 1) || regexp_replace(substr(array_to_string(w, ''), 2), '[AEIOU]', '', 'g'), '(.)\1+', '\1', 'g');
  end if;
  return left(r, 4);
end;
$$;

create or replace function sc_artist_tag_of(p_artist text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$ select coalesce(nullif(a.tag, ''), sc_artist_tag(a.name)) from artists a where a.id = p_artist $$;

-- Owner: set an artist's tag (2-5 letters/numbers; empty = automatic).
create or replace function admin_set_artist_tag(p_artist text, p_tag text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare v text := nullif(upper(trim(coalesce(p_tag, ''))), '');
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if v is not null and v !~ '^[A-Z0-9$!]{2,5}$' then raise exception 'Tags are 2 to 5 letters or numbers.'; end if;
  update artists set tag = v where id = p_artist;
  return sc_artist_tag_of(p_artist);
end;
$$;
grant execute on function admin_set_artist_tag(text, text) to authenticated;

-- Fan badges are checked with the other premium perks.
create or replace function sc_profile_premium_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare paid boolean;
begin
  if new.accent is not null and new.accent !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Pick a colour like #8B7CF6.'; end if;
  if coalesce(array_length(new.showcase, 1), 0) > 6 then raise exception 'Up to 6 songs in your showcase.'; end if;
  if coalesce(array_length(new.fan_artists, 1), 0) > 3 then raise exception 'Up to 3 fan badges.'; end if;
  if new.fan_artists is distinct from old.fan_artists
     and exists (select 1 from unnest(new.fan_artists) f where not exists (select 1 from artists a where a.id = f)) then
    raise exception 'Unknown artist.';
  end if;
  if new.accent is distinct from old.accent and new.accent is not null
     or new.banner_url is distinct from old.banner_url and new.banner_url is not null
     or new.showcase is distinct from old.showcase and coalesce(array_length(new.showcase, 1), 0) > 0
     or new.fan_artists is distinct from old.fan_artists and coalesce(array_length(new.fan_artists, 1), 0) > 1
     or new.avatar_url is distinct from old.avatar_url and new.avatar_url ~* '\.gif(\?|$)' then
    paid := is_premium(new.id);
    if not paid then raise exception 'That''s a premium profile perk.'; end if;
  end if;
  return new;
end;
$$;

-- Badges for a set of people: supporter or not, and their fan tags (only
-- the first one counts without premium).
create or replace function rpc_user_badges(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_object_agg(p.id, jsonb_build_object(
    'supporter', is_premium(p.id),
    'fans', coalesce((select jsonb_agg(jsonb_build_object('artist_id', a.id, 'name', a.name, 'tag', coalesce(nullif(a.tag, ''), sc_artist_tag(a.name))) order by x.n)
       from unnest(p.fan_artists) with ordinality x(id, n) join artists a on a.id = x.id
       where x.n <= case when is_premium(p.id) then 3 else 1 end), '[]'::jsonb))), '{}'::jsonb)
  from profiles p where p.id = any (coalesce(p_ids, '{}'));
$$;
grant execute on function rpc_user_badges(uuid[]) to anon, authenticated;
