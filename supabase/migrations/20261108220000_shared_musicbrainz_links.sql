-- Three jobs (band members, Discogs, Wikipedia) each asked MusicBrainz for
-- the same artist's links, and MusicBrainz kept saying it was busy. Now the
-- links are saved with the artist the first time any job fetches them, and
-- the others reuse them for 30 days.
alter table artists add column if not exists mb_urls jsonb, add column if not exists mb_urls_at timestamptz;

create or replace function sc_mb_urls_save(p_secret text, p_artist text, p_urls jsonb)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  update artists set mb_urls = coalesce(p_urls, '[]'::jsonb), mb_urls_at = now() where id = p_artist;
end $function$;
revoke execute on function sc_mb_urls_save(text, text, jsonb) from public, anon, authenticated;

-- Hand the saved links to the Discogs and Wikipedia jobs.
do $do$
declare d text; n text;
begin
  d := pg_get_functiondef('sc_discogs_next'::regproc);
  n := replace(d, $a$select a.id, a.musicbrainz_id, a.discogs_id into r from artists a$a$,
                  $a$select a.id, a.musicbrainz_id, a.discogs_id, case when a.mb_urls_at > now() - interval '30 days' then a.mb_urls end mb_urls into r from artists a$a$);
  n := replace(n, $a$'mbid', r.musicbrainz_id, 'discogs_id', r.discogs_id)$a$, $a$'mbid', r.musicbrainz_id, 'discogs_id', r.discogs_id, 'mb_urls', r.mb_urls)$a$);
  if n = d or n !~ 'r\.mb_urls\)' then raise exception 'sc_discogs_next patch did not apply'; end if;
  execute n;

  d := pg_get_functiondef('sc_wiki_next'::regproc);
  n := replace(d, $a$select a.id, a.musicbrainz_id into r from artists a$a$,
                  $a$select a.id, a.musicbrainz_id, case when a.mb_urls_at > now() - interval '30 days' then a.mb_urls end mb_urls into r from artists a$a$);
  n := replace(n, $a$'mbid', r.musicbrainz_id)$a$, $a$'mbid', r.musicbrainz_id, 'mb_urls', r.mb_urls)$a$);
  if n = d or n !~ 'r\.mb_urls\)' then raise exception 'sc_wiki_next patch did not apply'; end if;
  execute n;
end $do$;
