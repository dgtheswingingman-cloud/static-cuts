-- Help Wanted for admins: instead of suggesting a fix for someone to review,
-- an admin fills the gap straight away. Moderators and admins only.

-- Released songs missing a release date or album. Only fills what's empty:
-- never overwrites a date or album the song already has.
create or replace function admin_help_fill(p_track_id text, p_release_date date default null, p_album text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_album text := nullif(trim(coalesce(p_album, '')), '');
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_release_date is null and v_album is null then raise exception 'Nothing to fill in.'; end if;
  if p_release_date is not null and (p_release_date < date '1900-01-01' or p_release_date > current_date + 366) then
    raise exception 'That date looks wrong.';
  end if;
  if not exists (select 1 from tracks where id = p_track_id) then raise exception 'That song is gone.'; end if;
  -- Nothing empty to fill: leave it (and don't add an empty entry to Undo).
  if not exists (select 1 from tracks where id = p_track_id
                 and ((release_date is null and p_release_date is not null) or (album is null and v_album is not null))) then
    return;
  end if;
  -- Admin edits go in a batch, so they show (and can be undone) under Undo.
  if is_admin() then
    perform set_config('static_cuts.batch_id', '', true);
    perform sc_begin_batch('help', 'Filled in from Help Wanted');
  end if;
  update tracks set release_date = coalesce(release_date, p_release_date), album = coalesce(album, v_album)
  where id = p_track_id;
  if not found then raise exception 'That song is gone.'; end if;
end $$;

-- A cover for a song with none: saved as an approved cover suggestion, so
-- the usual copy job puts it on Static-Cuts within a couple of minutes.
create or replace function admin_help_cover(p_track_id text, p_image_url text, p_source_url text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_img text := nullif(trim(coalesce(p_image_url, '')), '');
  v_src text := coalesce(nullif(trim(coalesce(p_source_url, '')), ''), nullif(trim(coalesce(p_image_url, '')), ''));
  v_cover text;
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if v_img is null or v_img !~* '^https://[^ ]+$' then raise exception 'Paste an https link to the picture itself.'; end if;
  select cover_url into v_cover from tracks where id = p_track_id;
  if not found then raise exception 'That song is gone.'; end if;
  if v_cover is not null then return 'has_cover'; end if;
  insert into cover_suggestions (track_id, image_url, source_url, notes, submitted_by, status, reviewed_by, reviewed_at)
  values (p_track_id, v_img, v_src, 'Added from Help Wanted', auth.uid(), 'approved', auth.uid(), now())
  on conflict (track_id, image_url) do update
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    where cover_suggestions.status in ('pending', 'failed', 'rejected');
  return 'added';
end $$;

-- A possible link that's the wrong song: take it off the list.
create or replace function admin_help_reject_link(p_candidate uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  delete from track_link_candidates where id = p_candidate;
  if not found then raise exception 'That suggestion is gone.'; end if;
end $$;

revoke execute on function admin_help_fill(text, date, text) from public, anon;
revoke execute on function admin_help_cover(text, text, text) from public, anon;
revoke execute on function admin_help_reject_link(uuid) from public, anon;
grant execute on function admin_help_fill(text, date, text) to authenticated;
grant execute on function admin_help_cover(text, text, text) to authenticated;
grant execute on function admin_help_reject_link(uuid) to authenticated;
