-- Approving an imported song that's already on the page (same title, or the
-- same song written differently, e.g. "Blow (Cirkut Remix)" vs "Blow -
-- Cirkut Remix") quietly moved it to "dismissed". Now it's marked
-- extra.already_on_page = the title it matched, so the page can say so.

do $$
declare
  d text := pg_get_functiondef('public.admin_apply_import_suggestions(uuid[], text)'::regprocedure);
  a text := 'update import_suggestions set state = ''dismissed'', decided_at = now() where id = s.id;';
  b text := 'update import_suggestions set state = ''dismissed'', decided_at = now(),
        extra = coalesce(extra, ''{}''::jsonb) || jsonb_build_object(''already_on_page'', coalesce(
          (select t.title from track_title_keys k join tracks t on t.id = k.track_id
           where k.artist_id = s.artist_id and (k.key = sc_title_key(s.title) or k.song_key = sc_song_key(s.title))
           limit 1), ''yes''))
      where id = s.id;';
begin
  if position(a in d) > 0 then
    execute replace(d, a, b);
  end if;
end $$;

-- The ones already dismissed this way (all matched a song on the page).
update import_suggestions s
set extra = coalesce(s.extra, '{}'::jsonb) || jsonb_build_object('already_on_page', m.title)
from (
  select d.id, (select t.title from track_title_keys k join tracks t on t.id = k.track_id
                where k.artist_id = d.artist_id and (k.key = sc_title_key(d.title) or k.song_key = sc_song_key(d.title))
                limit 1) title
  from import_suggestions d
  where d.state = 'dismissed' and not coalesce(d.extra ? 'already_on_page', false)
) m
where s.id = m.id and m.title is not null;
