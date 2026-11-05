-- Permission rules check who you are once per query, not once per row; three
-- missing indexes the database advisor flagged.
alter policy slc_add on song_list_comments with check ((user_id = (select auth.uid())) and sc_list_visible(list_id) and (not is_oauth_client()));
alter policy slc_remove on song_list_comments using ((user_id = (select auth.uid())) or is_moderator() or exists (select 1 from song_lists l where l.id = song_list_comments.list_id and l.owner_id = (select auth.uid())));
alter policy slr_own on song_list_ratings using (user_id = (select auth.uid()))
  with check ((user_id = (select auth.uid())) and sc_list_visible(list_id) and (not is_oauth_client()) and not exists (select 1 from song_lists l where l.id = song_list_ratings.list_id and l.owner_id = (select auth.uid())));
alter policy "See your own premium" on premium_members using (user_id = (select auth.uid()));
create index if not exists artist_members_member_id_idx on artist_members (member_id);
create index if not exists song_list_comments_user_id_idx on song_list_comments (user_id);
create index if not exists song_list_ratings_user_id_idx on song_list_ratings (user_id);
