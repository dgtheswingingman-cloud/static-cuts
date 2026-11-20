-- Album search for 1–2 letter words ("me", "ok") was slow (0.3–0.8 s):
-- the fuzzy (trigram) indexes need 3+ letters, so short words read every
-- album. Short words now match titles that START with the word, using
-- plain A–Z indexes. 3+ letters work as before.

create index if not exists deezer_albums_title_prefix
  on public.deezer_albums (lower(title) text_pattern_ops);
create index if not exists tracks_album_prefix
  on public.tracks (lower(album) text_pattern_ops)
  where album is not null and parent_track_id is null;

do $patch$
declare d text; old text := $o$v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';$o$;
begin
  d := pg_get_functiondef('public.rpc_search_albums(text)'::regprocedure);
  if position(old in d) = 0 then raise exception 'rpc_search_albums: expected line not found'; end if;
  d := replace(d, old,
    $n$v_like := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  -- 1–2 letters: titles that start with it (fast A–Z index); longer: anywhere.
  if length(v_q) >= 3 then v_like := '%' || v_like; end if;$n$);
  execute d;
end $patch$;
