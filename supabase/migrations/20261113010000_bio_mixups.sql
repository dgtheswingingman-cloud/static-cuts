-- Bio mix-ups: bios (from Last.fm etc.) that describe someone else. Services
-- sometimes merge two artists with similar names (Last.fm's "Sir Cartier" page
-- says it's an old name of Playboi Carti), so the bio on our page is about the
-- wrong person. A weekly scan flags:
--   alias    - the bio calls this an alias / old name / pseudonym of another
--              artist that has a page here ("...old pseudonyms for Playboi Carti")
--   multiple - the bio is a "there are several artists with this name" page
-- Flags go to Review > Clean-up > Bio mix-ups. "Clear bio" blanks it (a blank
-- bio is never fetched again); "bio is right" means it's never flagged again.
-- Release mix-ups were tried too but can't be told apart from real
-- collaborations with the data Deezer gives, so they're left out.

create table if not exists artist_mixup_flags (
  id uuid primary key default gen_random_uuid(),
  artist_id text not null references artists(id) on delete cascade,
  kind text not null check (kind in ('alias', 'multiple')),
  other_artist_id text references artists(id) on delete cascade,
  other_key text not null default '',
  excerpt text,
  bio_hash text,
  state text not null default 'open' check (state in ('open', 'ok', 'cleared', 'gone')),
  found_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (artist_id, kind, other_key)
);
alter table artist_mixup_flags enable row level security;

create or replace function sc_mixup_scan()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  perform set_config('statement_timeout', '120s', true);
  -- Flags whose bio has since changed or been cleared close themselves.
  update artist_mixup_flags f set state = 'gone', decided_at = now()
  from artists a where a.id = f.artist_id and f.state = 'open'
    and (coalesce(a.bio, '') = '' or md5(a.bio) <> coalesce(f.bio_hash, ''));

  with cand as (
    select id, name, bio from artists
    where coalesce(bio, '') <> '' and coalesce(bio_source, '') <> 'Static Cuts'
      and bio ~* '(pseudonym|alias|formerly known as|previously known as|old name|stage name|better known as|now known as|also performs as|side project of|alter ego|there (are|is|were) (at least )?(more than one|multiple|several|two|three|four|five|\d+) (artists?|bands?|acts?))'
  ),
  hits as (
    select c.id artist_id, 'alias'::text kind, o.id other_artist_id, o.id other_key,
           substring(c.bio from greatest(1, position(lower(o.name) in lower(c.bio)) - 110) for 240) excerpt, md5(c.bio) bio_hash
    from cand c join artists o on o.id <> c.id and length(o.name) >= 4 and position(lower(o.name) in lower(c.bio)) > 0
    where c.bio ~* ('(pseudonym|alias|formerly known as|previously known as|old name|stage name|better known as|now known as|also performs as|side project of|alter ego)[^.]{0,60}\m'
                    || regexp_replace(o.name, '([.$^*+?()\[\]{}|\\])', '\\\1', 'g') || '\M')
    union all
    select id, 'multiple', null, '', left(bio, 240), md5(bio) from cand
    where bio ~* '^\s*there (are|is|were) (at least )?(more than one|multiple|several|two|three|four|five|\d+) (artists?|bands?|acts?)'
  )
  insert into artist_mixup_flags (artist_id, kind, other_artist_id, other_key, excerpt, bio_hash)
  select artist_id, kind, other_artist_id, other_key, excerpt, bio_hash from hits
  on conflict (artist_id, kind, other_key) do update
    set state = 'open', excerpt = excluded.excerpt, bio_hash = excluded.bio_hash, found_at = now(), decided_at = null
    where artist_mixup_flags.state = 'gone' and artist_mixup_flags.bio_hash is distinct from excluded.bio_hash;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke execute on function sc_mixup_scan() from public, anon, authenticated;

create or replace function admin_mixup_list(p_limit int default 500)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select case when not is_moderator() then null else jsonb_build_object(
    'count', (select count(*) from artist_mixup_flags where state = 'open'),
    'items', coalesce((select jsonb_agg(x order by x->>'artist') from (
      select jsonb_build_object('id', f.id, 'kind', f.kind, 'artist_id', f.artist_id, 'artist', a.name,
               'other_id', f.other_artist_id, 'other', o.name, 'excerpt', f.excerpt, 'source', a.bio_source, 'source_url', a.bio_source_url) x
      from artist_mixup_flags f join artists a on a.id = f.artist_id left join artists o on o.id = f.other_artist_id
      where f.state = 'open' order by a.name limit greatest(1, least(coalesce(p_limit, 500), 1000))) s), '[]'::jsonb)) end
$function$;

create or replace function admin_mixup_action(p_ids uuid[], p_action text)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_action not in ('clear', 'ok') then raise exception 'unknown action'; end if;
  if p_action = 'clear' then
    perform sc_begin_batch('merge', 'Bio mix-ups: ' || coalesce(array_length(p_ids, 1), 0) || ' bios cleared');
    -- Blank, not null: a blank bio is never fetched again.
    update artists set bio = '', bio_source = null, bio_source_url = null
    where id in (select artist_id from artist_mixup_flags where id = any (p_ids) and state = 'open');
  end if;
  update artist_mixup_flags set state = case when p_action = 'clear' then 'cleared' else 'ok' end, decided_at = now()
  where id = any (p_ids) and state = 'open';
  get diagnostics n = row_count;
  -- "Bio is right" on one flag covers the other flags from the same bio.
  if p_action = 'ok' then
    update artist_mixup_flags f set state = 'ok', decided_at = now()
    where f.state = 'open' and exists (select 1 from artist_mixup_flags g where g.id = any (p_ids) and g.artist_id = f.artist_id and g.bio_hash = f.bio_hash);
  end if;
  return n;
end $function$;

select cron.schedule('bio-mixups', '43 4 * * 1', $c$select public.sc_mixup_scan()$c$);
select public.sc_mixup_scan();
