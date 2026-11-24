-- New NIX job (24 Nov): suggested links. The search jobs have found ~3,500
-- possible links (mostly YouTube uploads) for songs, each with the title of
-- the video/track they point to. NIX reads each one next to the song and says
-- "match", "wrong_version" (e.g. an instrumental or remix of it),
-- "wrong_song" or "unsure"; Claude checks it and the final say settles
-- disagreements, like the other review notes. They're listed on
-- /review/links, where a moderator can use a link or remove it.

create or replace function public.sc_nix_valid_verdict(p_kind text, v text)
returns boolean language sql immutable as $$
  select lower(coalesce(v, '')) = any (case p_kind
    when 'duplicates' then array['same', 'different', 'unsure']
    when 'cleanup' then array['not_song', 'placeholder', 'real_song', 'unsure']
    when 'mixups' then array['mixup', 'fine', 'unsure']
    when 'deezer' then array['same', 'different', 'mixed', 'unsure']
    when 'audit' then array['yes', 'no', 'unsure']
    when 'links' then array['match', 'wrong_version', 'wrong_song', 'unsure']
    else null end);
$$;

do $$
declare d text;
begin
  -- what NIX reads
  d := pg_get_functiondef('public.sc_nix_review_items'::regproc);
  d := replace(d, '  end if;
  return coalesce(v, ''[]'');', '  elsif p_kind = ''links'' then
    select coalesce(jsonb_agg(jsonb_build_object(''key'', x.id, ''line'', x.line)), ''[]'') into v from (
      select c.id::text id,
        format(''song: "%s" by %s (%s%s%s) | found link on %s%s: "%s"'', t.title, coalesce(a.name, ''?''), t.release_status,
          case when nullif(t.album, '''') is not null then '', album "'' || t.album || ''"'' else '''' end,
          case when t.length_sec is not null then '', '' || sc_mmss(t.length_sec) else '''' end,
          coalesce(c.source_domain, ''?''), case when c.link_kind is not null then '' ('' || c.link_kind || '')'' else '''' end,
          left(coalesce(c.title, c.url), 200)) line
      from track_link_candidates c join tracks t on t.id = c.track_id left join artists a on a.id = t.artist_id
      where not exists (select 1 from nix_notes n where n.kind = ''links'' and n.item_key = c.id::text)
        and not exists (select 1 from nix_ai_jobs j where j.kind = ''review:links'' and j.status in (''queued'', ''running'') and j.payload -> ''keys'' ? c.id::text)
      order by c.found_at desc nulls last limit p_limit) x;
  end if;
  return coalesce(v, ''[]'');');
  if position('p_kind = ''links''' in d) = 0 then raise exception 'items patch missed'; end if;
  execute d;

  -- how NIX is asked
  d := pg_get_functiondef('public.sc_nix_review_prompt(text, jsonb)'::regprocedure);
  d := replace(d, '  else
    head := ''You help the admins of a fan music archive. Each artist below was matched to a Deezer', '  elsif p_kind = ''links'' then
    head := ''You help the admins of a fan music archive (released songs, leaks, snippets). Each line is a song and a link someone''''s search found for it, with the title of the video or track the link points to.
"match": the link is this song, in this version (an upload titled "Artist - Song", "Song (Official Audio)", "Song [Leak]" or with "prod. X" is fine).
"wrong_version": the same song but a different version than the one on the archive: instrumental, remix, sped up/slowed, live, snippet, a numbered version, or a cover.
"wrong_song": a different song, a different artist, or not a song at all (an interview, a full album or tape, a playlist, a reaction).
"unsure": can''''t tell from the titles.'';
    opts := ''match|wrong_version|wrong_song|unsure'';
  else
    head := ''You help the admins of a fan music archive. Each artist below was matched to a Deezer');
  if position('p_kind = ''links''' in d) = 0 then raise exception 'prompt patch missed'; end if;
  execute d;

  -- NIX's queue
  d := pg_get_functiondef('public.sc_nix_review'::regproc);
  d := replace(d, 'array[''duplicates'', ''cleanup'', ''mixups'', ''deezer'']', 'array[''duplicates'', ''cleanup'', ''mixups'', ''deezer'', ''links'']');
  d := replace(d, 'size := case k when ''duplicates'' then 20', 'size := case k when ''links'' then 25 when ''duplicates'' then 20');
  if position('''links''' in d) = 0 then raise exception 'review patch missed'; end if;
  execute d;

  -- Claude's check and the final say
  d := pg_get_functiondef('public.sc_nix_check_batch'::regproc);
  d := replace(d, 'kind in (''cleanup'', ''mixups'', ''deezer'', ''duplicates'')', 'kind in (''cleanup'', ''mixups'', ''deezer'', ''links'', ''duplicates'')');
  d := replace(d, 'array[''cleanup'', ''mixups'', ''deezer'', ''duplicates'']', 'array[''cleanup'', ''mixups'', ''deezer'', ''links'', ''duplicates'']');
  d := replace(d, 'when v_kind in (''mixups'', ''deezer'') then least(p_limit, 15)', 'when v_kind in (''mixups'', ''deezer'') then least(p_limit, 15) when v_kind = ''links'' then least(p_limit, 30)');
  if position('''links''' in d) = 0 then raise exception 'check patch missed'; end if;
  execute d;
  d := pg_get_functiondef('public.sc_nix_judge_batch'::regproc);
  d := replace(d, 'array[''cleanup'', ''mixups'', ''deezer'', ''duplicates'']', 'array[''cleanup'', ''mixups'', ''deezer'', ''links'', ''duplicates'']');
  if position('''links''' in d) = 0 then raise exception 'judge patch missed'; end if;
  execute d;

  -- the scoreboard
  d := pg_get_functiondef('public.admin_nix_jobs_progress'::regproc);
  d := replace(d, '(''deezer'', ''Deezer check notes'', ''review''),', '(''deezer'', ''Deezer check notes'', ''review''), (''links'', ''Suggested links'', ''review''),');
  d := replace(d, '      ''left'', case k.kind
', '      ''left'', case k.kind
        when ''links'' then (select count(*) from track_link_candidates c where not exists (select 1 from nix_notes n where n.kind = ''links'' and n.item_key = c.id::text))
');
  if position('Suggested links' in d) = 0 or position('when ''links'' then (select count(*) from track_link_candidates' in d) = 0 then raise exception 'progress patch missed'; end if;
  execute d;
end $$;

update public.nix_tasks set only_if = replace(only_if, '(''cleanup'', ''mixups'', ''deezer'', ''duplicates'')', '(''cleanup'', ''mixups'', ''deezer'', ''links'', ''duplicates'')')
where name = 'nix-check';

-- /review/links: the found links with what NIX, Claude and the final say thought.
create or replace function public.admin_nix_links(p_pile text default 'match', p_limit int default 200)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with x as (
    select c.id, c.url, c.title link_title, c.source_domain, c.link_kind, c.found_at,
      t.id track_id, t.title, t.release_status, t.spotify_url current_url, a.id artist_id, a.name artist,
      n.verdict, n.note, n.check_verdict, n.check_answer, n.check_note, n.final_side, n.final_answer, n.final_note,
      -- the answer that stands: the final say if there is one, else NIX's when Claude agreed
      case when n.final_side in ('checker', 'neither') then n.final_answer
           when n.final_side = 'nix' or n.check_verdict = 'agree' then n.verdict
           when n.verdict is null then 'waiting'
           else 'unsure' end settled
    from track_link_candidates c join tracks t on t.id = c.track_id left join artists a on a.id = t.artist_id
    left join nix_notes n on n.kind = 'links' and n.item_key = c.id::text)
  select case when is_moderator() then jsonb_build_object(
    'piles', (select jsonb_build_object(
        'match', count(*) filter (where settled = 'match'),
        'wrong', count(*) filter (where settled in ('wrong_version', 'wrong_song')),
        'unsure', count(*) filter (where settled not in ('match', 'wrong_version', 'wrong_song', 'waiting')),
        'waiting', count(*) filter (where settled = 'waiting')) from x),
    'items', (select coalesce(jsonb_agg(to_jsonb(q) order by q.artist, q.title), '[]') from (
      select * from x
      where case p_pile when 'match' then settled = 'match' when 'wrong' then settled in ('wrong_version', 'wrong_song')
                        when 'waiting' then settled = 'waiting' else settled not in ('match', 'wrong_version', 'wrong_song', 'waiting') end
      order by artist, title limit greatest(1, least(coalesce(p_limit, 200), 500))) q))
  end;
$$;
revoke all on function public.admin_nix_links(text, int) from public, anon;
grant execute on function public.admin_nix_links(text, int) to authenticated;

-- Remove found links (a moderator's decision; the song isn't touched).
create or replace function public.admin_remove_link_candidates(p_ids uuid[])
returns int language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  delete from track_link_candidates where id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.admin_remove_link_candidates(uuid[]) from public, anon;
grant execute on function public.admin_remove_link_candidates(uuid[]) to authenticated;
