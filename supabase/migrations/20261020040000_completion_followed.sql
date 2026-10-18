-- A profile's collection percentage counts only the artists that person
-- follows: songs collected from followed artists out of all their songs.
create or replace view user_completion_stats as
  select p.id as user_id,
    (select count(*) from tracks t join follows f on f.artist_id = t.artist_id and f.user_id = p.id) as total_tracks,
    (select count(*) from track_ownership o join tracks t on t.id = o.track_id
       join follows f on f.artist_id = t.artist_id and f.user_id = p.id
     where o.user_id = p.id) as collected_tracks,
    (select count(*) from follows f where f.user_id = p.id) as followed_artists
  from profiles p
  where p.show_completion_pct = true;

select collected_tracks, total_tracks, followed_artists from user_completion_stats
where user_id = (select id from auth.users where email = 'dg.theswingingman@gmail.com');
