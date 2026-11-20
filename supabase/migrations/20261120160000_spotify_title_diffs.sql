-- Spotify title check (Nathan, 20 Nov: "slow, in the background").
-- The hourly link checker (verify-spotify-links, a few hundred songs a day)
-- already reads each linked song's title from Spotify. When the artist
-- matches but the title is spelled differently, it's now listed for a
-- moderator (Clean-up → Spelling), rather than counted as fine. Nothing is
-- changed automatically and no extra Spotify calls are made.

create table if not exists public.spotify_title_diffs (
  track_id text primary key references public.tracks(id) on delete cascade,
  spotify_url text not null,
  spotify_title text not null,
  site_title text not null,
  found_at timestamptz not null default now(),
  resolved text check (resolved in ('ours', 'spotify')),
  resolved_by uuid,
  resolved_at timestamptz
);
alter table public.spotify_title_diffs enable row level security;

-- The save step: same as before, plus the spelling check.
do $patch$
declare d text; old text := $o$      else
        v_ok := v_ok + 1;
      end if;$o$;
begin
  d := pg_get_functiondef('public.sc_spotify_verify_save(text, jsonb)'::regprocedure);
  if position(old in d) = 0 then raise exception 'sc_spotify_verify_save: expected block not found'; end if;
  d := replace(d, old, $n$      else
        v_ok := v_ok + 1;
        -- Right artist, different spelling: listed for a moderator.
        if sc_title_key(r.title) <> ''
           and position(sc_title_key(r.title) in sc_title_key(r.t_title || ' ' || coalesce(r.aliases, ''))) = 0
           and position(sc_title_key(r.t_title) in sc_title_key(r.title)) = 0
        then
          insert into spotify_title_diffs (track_id, spotify_url, spotify_title, site_title)
          values (r.track_id, r.url, left(r.title, 300), left(r.t_title, 300))
          on conflict (track_id) do update set spotify_url = excluded.spotify_url, spotify_title = excluded.spotify_title,
            site_title = excluded.site_title, found_at = now(), resolved = null, resolved_by = null, resolved_at = null
          where spotify_title_diffs.spotify_title <> excluded.spotify_title or spotify_title_diffs.site_title <> excluded.site_title;
        end if;
      end if;$n$);
  execute d;
end $patch$;

-- Spotify's title without the extras it adds: "(feat. …)", "(with …)",
-- " - Remastered 2011" and the like.
create or replace function public.sc_spotify_clean_title(p text)
returns text language sql immutable set search_path to 'public' as $$
  select nullif(trim(regexp_replace(regexp_replace(coalesce(p, ''),
    '\s*[\(\[](feat\.?|ft\.?|featuring|with)\s[^\)\]]*[\)\]]', '', 'gi'),
    '\s+-\s+[^-]*(remaster|version|edit|mix|live|mono|stereo)[^-]*$', '', 'i')), '');
$$;

create or replace function public.admin_title_diffs(p_limit integer default 300)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'count', (select count(*) from spotify_title_diffs d join tracks t on t.id = d.track_id
              where d.resolved is null and t.spotify_url = d.spotify_url and t.title = d.site_title),
    'items', (select coalesce(jsonb_agg(x order by x.artist, x.title), '[]'::jsonb) from (
      select t.id, t.title, t.artist_id, a.name artist, t.release_status status, d.spotify_url,
             d.spotify_title, sc_spotify_clean_title(d.spotify_title) spotify_clean
      from spotify_title_diffs d join tracks t on t.id = d.track_id join artists a on a.id = t.artist_id
      where d.resolved is null and t.spotify_url = d.spotify_url and t.title = d.site_title
      order by a.name, t.title limit greatest(1, least(coalesce(p_limit, 300), 1000))) x));
end $$;

-- 'spotify': use Spotify's spelling (without the feat./remaster extras); the
-- old title is kept as an alias so searches still find it. Undoable.
-- 'ours': our spelling is right; not listed again.
create or replace function public.admin_title_diff_action(p_ids text[], p_action text)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_action not in ('ours', 'spotify') then raise exception 'unknown action'; end if;
  if p_action = 'spotify' then
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('cleanup', 'Clean-up: used Spotify''s spelling on ' || cardinality(p_ids) || ' song' || case when cardinality(p_ids) = 1 then '' else 's' end);
    update tracks t set
      title = sc_spotify_clean_title(d.spotify_title),
      aliases = nullif(trim(both ', ' from coalesce(t.aliases, '') || ', ' || t.title), '')
    from spotify_title_diffs d
    where d.track_id = t.id and t.id = any (p_ids) and d.resolved is null
      and t.spotify_url = d.spotify_url and t.title = d.site_title
      and sc_spotify_clean_title(d.spotify_title) is not null;
  end if;
  update spotify_title_diffs set resolved = p_action, resolved_by = auth.uid(), resolved_at = now()
  where track_id = any (p_ids) and resolved is null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.admin_title_diffs(integer), public.admin_title_diff_action(text[], text) from public, anon;
grant execute on function public.admin_title_diffs(integer), public.admin_title_diff_action(text[], text) to authenticated;
