-- Nathan, 25 Nov ("Yeah"): 1,359 main songs on the launch artists' pages have
-- no status. The trackers can't settle them (only ~108 appear on a tracker,
-- and those are copies of tracker songs: "Yah Mean [Master File]" beside
-- "Yah Mean"). New NIX job "Status & copies": for each one NIX either says it's
-- the same song as / a version of a song already on the page (shown letters
-- A-C from sc_nix_copy_hints), or gives a status (released / leaked / snippet),
-- or "unknown" (nothing made). Claude checks every one like the other jobs;
-- nothing changes until accepted on /review/nix. Accepting:
--   status   -> sets it (only while the song is still unconfirmed)
--   same     -> merges the copy into the song already on the page
--   version  -> files it under that song (only if it has no versions of its own)
-- All of it in the usual undo batch.

alter table public.nix_suggestions add column if not exists target_track_id text;

-- Songs already on the same artist's page that this one might be a copy of:
-- same title with brackets, symbols and hidden characters ignored, against
-- the other song's title or its other names. Main songs only, up to 3.
create or replace function public.sc_nix_copy_hints(p_track text)
returns table (n int, id text, title text, status text)
language sql stable security definer set search_path = public as $$
  with u as (
    select t.artist_id, regexp_replace(regexp_replace(lower(t.title), '\s*[\(\[\{][^\)\]\}]*[\)\]\}]', '', 'g'), '[^a-z0-9]', '', 'g') k
    from tracks t where t.id = p_track),
  c as (
    select distinct coalesce(x.parent_track_id, x.id) mid
    from tracks x, u
    where x.artist_id = u.artist_id and x.id <> p_track and length(u.k) >= 4
      and coalesce(x.release_status, 'unconfirmed') <> 'unconfirmed'
      and '|' || array_to_string(array(
            select regexp_replace(p, '[^a-z0-9]', '', 'g')
            from regexp_split_to_table(lower(x.title || coalesce(' / ' || x.aliases, '')), '\s*[\(\)\[\]/,]\s*') p), '|') || '|'
          like '%|' || u.k || '|%')
  select (row_number() over (order by m.title, m.id))::int, m.id, m.title, m.release_status
  from c join tracks m on m.id = c.mid
  where m.id <> p_track and m.parent_track_id is null
  order by m.title, m.id
  limit 3
$$;
revoke all on function public.sc_nix_copy_hints(text) from public, anon, authenticated;

-- The prompt NIX gets.
do $$
declare d text := pg_get_functiondef('public.sc_nix_suggest_batch(text)'::regprocedure);
begin
  d := replace(d, $p$when 'audit' then 30 else 20 end$p$, $p$when 'audit' then 30 when 'status' then 15 else 20 end$p$);
  d := replace(d, $p$  elsif p_kind = 'audit' then
    select string_agg(o.n || '. ' || coalesce(sc_version_line(o.k::uuid), '?'), E'\n' order by o.n) into lines$p$,
$p$  elsif p_kind = 'status' then
    select string_agg(format('%s. "%s" by %s%s%s%s | came from: %s%s%s', o.n, t.title, coalesce(a.name, '?'),
        case when t.album is not null then ' | era/album: ' || t.album else '' end,
        case when t.release_date is not null then ' | dated ' || t.release_date else '' end,
        case when t.leak_date is not null then ' | leaked ' || t.leak_date else '' end,
        case t.source when 'local' then 'a listener''s file' when 'lastfm' then 'Last.fm' when 'genius' then 'Genius' when 'sheet' then 'a tracker' else 'unknown' end,
        case when nullif(t.notes, '') is not null then ' | notes: "' || left(regexp_replace(t.notes, '\s+', ' ', 'g'), 250) || '"' else '' end,
        coalesce((select ' | already on the page: ' || string_agg(chr(64 + h.n) || ') "' || h.title || '" (' || coalesce(h.status, '?') || ')', '  ' order by h.n)
                  from sc_nix_copy_hints(t.id) h), '')), E'\n' order by o.n)
    into lines
    from unnest(keys) with ordinality o(k, n) join tracks t on t.id = o.k left join artists a on a.id = t.artist_id;
    head := 'These songs in a fan music archive have no status yet. For each one decide:
1) copy_of: when the line lists songs "already on the page" and this song is really one of them filed again, give that song''s letter (A, B or C), and in "copy" say "same" (the same recording twice: the same title apart from formatting, symbols, hidden characters or a file tag like [Master File], [CDQ], [HQ]) or "version" (another take of that song: remix, live, demo, session, instrumental, [V2], an intro or outro edit, sped up or slowed). Otherwise copy_of and copy are null.
2) status, only when copy_of is null: "released" (officially out: on an official album, single or streaming service), "leaked" (never officially released, but the full song is out among fans), "snippet" (only a short clip is out), or "unknown". Say released, leaked or snippet only when the line shows it or you really know this song. Otherwise "unknown". Never guess.';
    v_prompt := head || E'\n\n' || lines || E'\n\nReply with JSON only: {"r":[{"n":1,"copy_of":null,"copy":null,"status":"unknown","why":"a few words","sure":"medium"}, ...]} covering every number. "sure" is how sure you are: high, medium or low.';
  elsif p_kind = 'audit' then
    select string_agg(o.n || '. ' || coalesce(sc_version_line(o.k::uuid), '?'), E'\n' order by o.n) into lines$p$);
  if position($p$p_kind = 'status' then$p$ in d) = 0 or position($p$when 'status' then 15$p$ in d) = 0 then raise exception 'patch missed: suggest_batch'; end if;
  execute d;
end $$;

-- Saving NIX's answers as suggestions.
do $$
declare d text := pg_get_functiondef('public.sc_nix_suggest_save(text, text, text, jsonb, text)'::regprocedure);
begin
  d := replace(d, 'declare t tracks; n int := 0; val text; vs version_suggestions; pt text;',
                  'declare t tracks; n int := 0; val text; vs version_suggestions; pt text; tid text; ttl text;');
  d := replace(d, $p$  elsif p_kind = 'titles' then$p$,
$p$  elsif p_kind = 'status' then
    if coalesce(t.release_status, 'unconfirmed') <> 'unconfirmed' or t.parent_track_id is not null then return 0; end if;
    val := upper(left(btrim(coalesce(r ->> 'copy_of', ''), ' "()'), 1));
    if val ~ '^[A-C]$' and lower(coalesce(r ->> 'copy', '')) in ('same', 'version') then
      select h.id, h.title into tid, ttl from sc_nix_copy_hints(t.id) h where h.n = ascii(val) - 64;
      if tid is not null then
        insert into nix_suggestions (kind, track_id, field, current_value, suggested, note, model, confidence, target_track_id)
        values ('status', t.id, 'copy_of', ttl, case lower(r ->> 'copy') when 'same' then 'same song' else 'version' end,
                left(r ->> 'why', 200), p_model, case when lower(r ->> 'sure') in ('high', 'medium', 'low') then lower(r ->> 'sure') end, tid)
        on conflict do nothing;
        return 1;
      end if;
    end if;
    val := lower(btrim(coalesce(r ->> 'status', '')));
    if val in ('released', 'leaked', 'snippet') then
      insert into nix_suggestions (kind, track_id, field, current_value, suggested, note, model, confidence)
      values ('status', t.id, 'release_status', 'unconfirmed', val, left(r ->> 'why', 200), p_model,
              case when lower(r ->> 'sure') in ('high', 'medium', 'low') then lower(r ->> 'sure') end)
      on conflict do nothing;
      n := 1;
    end if;
  elsif p_kind = 'titles' then$p$);
  if position($p$p_kind = 'status' then$p$ in d) = 0 or position('tid text; ttl text;' in d) = 0 then raise exception 'patch missed: suggest_save'; end if;
  execute d;
end $$;

-- What Claude sees when it checks one.
do $$
declare d text := pg_get_functiondef('public.sc_nix_check_line(bigint)'::regprocedure);
begin
  d := replace(d, $p$    when 'notes' then format('artist: %s | song: "%s" | notes: "%s" | NIX says: %s = "%s". Why: %s',$p$,
$p$    when 'status' then format('artist: %s | song: "%s"%s%s | came from: %s%s | NIX says: %s. Why: %s',
      coalesce(a.name, '?'), t.title,
      case when t.album is not null then ' | era/album: ' || t.album else '' end,
      case when coalesce(t.release_date, t.leak_date) is not null then ' | dated ' || coalesce(t.release_date, t.leak_date) else '' end,
      case t.source when 'local' then 'a listener''s file' when 'lastfm' then 'Last.fm' when 'genius' then 'Genius' when 'sheet' then 'a tracker' else 'unknown' end,
      case when nullif(t.notes, '') is not null then ' | notes: "' || left(regexp_replace(t.notes, '\s+', ' ', 'g'), 300) || '"' else '' end,
      case when s.field = 'copy_of'
        then case when s.suggested = 'same song' then 'it is the SAME song as' else 'it is a VERSION of' end
             || ' "' || coalesce(s.current_value, '?') || '" (' || coalesce((select x.release_status from tracks x where x.id = s.target_track_id), '?') || '), already on the page'
        else 'status = ' || s.suggested end,
      coalesce(s.note, '-'))
    when 'notes' then format('artist: %s | song: "%s" | notes: "%s" | NIX says: %s = "%s". Why: %s',$p$);
  if position($p$when 'status' then format$p$ in d) = 0 then raise exception 'patch missed: check_line'; end if;
  execute d;
end $$;

do $$
declare d text := pg_get_functiondef('public.sc_nix_check_rules(text)'::regprocedure);
begin
  d := replace(d, $p$    when 'titles' then 'TITLE items:$p$,
$p$    when 'status' then 'STATUS items: the song had no status. NIX either gave a status (released = officially out on an album, single or streaming; leaked = never officially released but the full song is out among fans; snippet = only a short clip is out), or said the song is the SAME song as, or a VERSION of, another song already on the artist''s page. Agree only when the line or well-known facts about this song support it; when you don''t know the song well enough, say unsure rather than agree. A file tag like [Master File], [CDQ] or [HQ], symbols or hidden characters mean the same song; remix, live, demo, session, instrumental, [V2], sped up or an intro/outro edit mean a version. A different song that only shares a word is neither. When you disagree, the right answer is exactly one of: released, leaked, snippet, unknown, same song, version, different.'
    when 'titles' then 'TITLE items:$p$);
  if position($p$when 'status' then 'STATUS items$p$ in d) = 0 then raise exception 'patch missed: check_rules'; end if;
  execute d;
end $$;

-- Claude thinks a little on these (like eras and notes), 20 at a time.
do $$
declare d text := pg_get_functiondef('public.sc_nix_check_batch(text, integer)'::regprocedure);
begin
  d := replace(d, $p$v_n := case when v_kind in ('eras', 'notes') then$p$, $p$v_n := case when v_kind in ('eras', 'notes', 'status') then$p$);
  d := replace(d, $p$think := v_kind in ('eras', 'notes', 'mixups', 'deezer');$p$, $p$think := v_kind in ('eras', 'notes', 'status', 'mixups', 'deezer');$p$);
  if position($p$'notes', 'status', 'mixups'$p$ in d) = 0 or position($p$('eras', 'notes', 'status') then$p$ in d) = 0 then raise exception 'patch missed: check_batch'; end if;
  execute d;
end $$;

-- The final say's answer must be one of the allowed words for these.
do $$
declare d text := pg_get_functiondef('public.sc_nix_judge_save(text, jsonb, jsonb)'::regprocedure);
begin
  d := replace(d, $p$                when 'album' then exists$p$,
$p$                when 'release_status' then lower(ans) in ('released', 'leaked', 'snippet')
                when 'copy_of' then lower(ans) in ('same song', 'same', 'version')
                when 'album' then exists$p$);
  d := replace(d, $p$        if usable and s.field = 'album' then$p$,
$p$        if usable and s.field in ('release_status', 'copy_of') then
          ans := case lower(ans) when 'same' then 'same song' else lower(ans) end;
        end if;
        if usable and s.field = 'album' then$p$);
  if position($p$when 'copy_of' then lower(ans)$p$ in d) = 0 or position($p$s.field in ('release_status', 'copy_of')$p$ in d) = 0 then raise exception 'patch missed: judge_save'; end if;
  execute d;
end $$;

-- Accepting.
do $$
declare d text := pg_get_functiondef('public.admin_nix_suggestions_decide(bigint[], boolean)'::regprocedure);
begin
  d := replace(d, $p$    elsif s.field = 'parent' then$p$,
$p$    elsif s.field = 'release_status' then
      if lower(coalesce(s.corrected, s.suggested)) in ('released', 'leaked', 'snippet') then
        update tracks set release_status = lower(coalesce(s.corrected, s.suggested))
        where id = s.track_id and coalesce(release_status, 'unconfirmed') = 'unconfirmed';
        applied := found;
      end if;
    elsif s.field = 'copy_of' then
      if exists (select 1 from tracks where id = s.target_track_id) and exists (select 1 from tracks where id = s.track_id) then
        if coalesce(s.corrected, s.suggested) = 'same song' then
          perform admin_merge_duplicates(s.target_track_id, array[s.track_id]);
          applied := true;
        elsif coalesce(s.corrected, s.suggested) = 'version' then
          update tracks set parent_track_id = (select coalesce(x.parent_track_id, x.id) from tracks x where x.id = s.target_track_id)
          where id = s.track_id and parent_track_id is null
            and not exists (select 1 from tracks c where c.parent_track_id = s.track_id);
          applied := found;
        end if;
      end if;
    elsif s.field = 'parent' then$p$);
  if position($p$s.field = 'copy_of' then$p$ in d) = 0 then raise exception 'patch missed: decide'; end if;
  execute d;
end $$;

-- Lessons, the on/off switch, the progress list.
do $$
declare d text := pg_get_functiondef('public.sc_nix_lessons_text(text, integer)'::regprocedure);
begin
  d := replace(d, $p$if p_kind in ('notes', 'eras', 'audit', 'titles') then$p$, $p$if p_kind in ('notes', 'eras', 'audit', 'titles', 'status') then$p$);
  if position($p$'titles', 'status') then$p$ in d) = 0 then raise exception 'patch missed: lessons'; end if;
  execute d;
end $$;

do $$
declare d text := pg_get_functiondef('public.admin_nix_kinds(text, boolean)'::regprocedure);
begin
  d := replace(d, $p$if p_kind not in ('titles', 'audit', 'notes', 'eras') then$p$, $p$if p_kind not in ('titles', 'audit', 'notes', 'eras', 'status') then$p$);
  if position($p$'eras', 'status') then$p$ in d) = 0 then raise exception 'patch missed: kinds'; end if;
  execute d;
end $$;

do $$
declare d text := pg_get_functiondef('public.admin_nix_jobs_progress()'::regprocedure);
begin
  d := replace(d, $p$('eras', 'Eras', 'suggest'))$p$, $p$('eras', 'Eras', 'suggest'), ('status', 'Status & copies', 'suggest'))$p$);
  if position($p$'Status & copies'$p$ in d) = 0 then raise exception 'patch missed: progress'; end if;
  execute d;
end $$;

-- Work list: launch artists' main songs with no status.
do $$
declare d text := pg_get_functiondef('public.sc_nix_work_seed()'::regprocedure);
begin
  d := replace(d, $p$  update nix_work set pending_at = null where pending_at < now() - interval '1 day';$p$,
$p$  insert into nix_work (kind, item_key)
  select 'status', t.id from tracks t join launch_artists l on l.artist_id = t.artist_id
  where t.parent_track_id is null and coalesce(t.release_status, 'unconfirmed') = 'unconfirmed'
    and not exists (select 1 from nix_notes n where n.kind = 'status' and n.item_key = t.id)
  on conflict do nothing;

  update nix_work set pending_at = null where pending_at < now() - interval '1 day';$p$);
  if position($p$select 'status', t.id$p$ in d) = 0 then raise exception 'patch missed: seed'; end if;
  execute d;
end $$;

insert into public.sc_private_settings (key, value) values ('nix_suggest_kinds', 'titles,audit,notes,status')
on conflict (key) do update set value = case when position('status' in sc_private_settings.value) > 0 then sc_private_settings.value
                                             else sc_private_settings.value || ',status' end;

select public.sc_nix_work_seed();
