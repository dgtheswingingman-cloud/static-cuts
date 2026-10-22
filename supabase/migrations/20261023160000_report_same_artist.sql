-- Anyone signed in can report that two artist pages are the same artist.
-- Reports land in the review list (New Artists → "Same artist" reports);
-- an admin picks which page to keep and they are merged with
-- admin_merge_artists.

alter table submissions drop constraint if exists submissions_type_check;
alter table submissions add constraint submissions_type_check check (type = any (array[
  'new_artist', 'new_track', 'new_version', 'correction', 'flag_link', 'flag_deletion', 'status_change', 'artist_merge']));

create or replace function report_same_artist(p_artist text, p_same_as text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_a text;
  v_b text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Log in to report this.'; end if;
  if p_artist is null or p_same_as is null or p_artist = p_same_as then raise exception 'Pick a different artist.'; end if;
  select name into v_a from artists where id = p_artist;
  select name into v_b from artists where id = p_same_as;
  if v_a is null or v_b is null then raise exception 'Unknown artist.'; end if;
  -- Already reported (either way round): don't add another.
  select id into v_id from submissions
  where type = 'artist_merge' and status = 'pending'
    and ((artist_id = p_artist and payload ->> 'into' = p_same_as)
      or (artist_id = p_same_as and payload ->> 'into' = p_artist))
  limit 1;
  if v_id is not null then return v_id; end if;
  insert into submissions (type, artist_id, payload, submitted_by)
  values ('artist_merge', p_artist,
          jsonb_build_object('into', p_same_as, 'from_name', v_a, 'into_name', v_b,
                             'note', nullif(left(trim(coalesce(p_note, '')), 300), '')),
          v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function report_same_artist(text, text, text) from public, anon;
grant execute on function report_same_artist(text, text, text) to authenticated;

-- Admin: act on a report. p_keep is the page that stays (either one).
create or replace function admin_approve_artist_merge(p_submission uuid, p_keep text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s submissions%rowtype;
  v_from text;
  v_into text;
  v_res jsonb;
begin
  if not is_admin() then raise exception 'Only admins can merge artists.'; end if;
  select * into s from submissions where id = p_submission and type = 'artist_merge' and status = 'pending';
  if s.id is null then raise exception 'That report was already dealt with.'; end if;
  if p_keep = s.artist_id then v_into := s.artist_id; v_from := s.payload ->> 'into';
  elsif p_keep = s.payload ->> 'into' then v_into := s.payload ->> 'into'; v_from := s.artist_id;
  else raise exception 'Keep one of the two pages.'; end if;
  v_res := admin_merge_artists(v_from, v_into);
  update submissions set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), resulting_id = v_into
  where id = p_submission;
  -- Other reports about the removed page now point at the kept one; close
  -- any that became "X is the same as X", and repoint the rest.
  update submissions set payload = jsonb_set(payload, '{into}', to_jsonb(v_into))
  where type = 'artist_merge' and status = 'pending' and payload ->> 'into' = v_from;
  update submissions set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(),
         reviewer_note = 'Already merged.', resulting_id = v_into
  where type = 'artist_merge' and status = 'pending' and artist_id = payload ->> 'into';
  return v_res;
end;
$$;
revoke execute on function admin_approve_artist_merge(uuid, text) from public, anon;
grant execute on function admin_approve_artist_merge(uuid, text) to authenticated;
