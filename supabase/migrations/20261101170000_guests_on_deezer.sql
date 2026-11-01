-- Guest artists are now checked on Deezer instead of Spotify. Spotify gives
-- us 25 calls an hour and its song-matching job used them all, so guests
-- were barely checked (about 30 a day, 12,000 waiting). Deezer has no
-- practical limit: up to 20 guests every 10 minutes. Same checks: exact
-- name, already an artist here -> link; one of their songs here found on
-- Deezer with them credited -> confirmed (a new page when new pages are
-- allowed and they have 300+ Deezer fans); otherwise the review list (only
-- for guests on 3+ songs; others are looked at again in a week).
-- Spotify is left for links.

alter table guest_artists add column if not exists deezer_artist_id text;

create or replace function sc_guest_found(p_secret text, p_key text, p_action text, p_artist text default null,
  p_deezer_id text default null, p_deezer_name text default null, p_note text default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g guest_artists%rowtype;
  v_artist text;
  v_name text;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then
    raise exception 'not authorized';
  end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select * into g from guest_artists where name_key = p_key;
  if g.name_key is null then return null; end if;
  v_name := coalesce(p_deezer_name, g.name);
  if p_action = 'review' and g.songs < 3 then
    -- One or two songs: not worth a moderator's time. Noted, and looked at
    -- again in a week (they may have more songs by then).
    update guest_artists set note = p_note, checked_at = now(), deezer_artist_id = coalesce(p_deezer_id, deezer_artist_id)
    where name_key = p_key;
    return null;
  end if;
  if p_action = 'review' then
    update guest_artists set state = 'review', note = p_note, checked_at = now(),
           deezer_artist_id = coalesce(p_deezer_id, deezer_artist_id)
    where name_key = p_key;
    return null;
  end if;
  if p_action = 'wait' then
    update guest_artists set checked_at = now(), deezer_artist_id = coalesce(p_deezer_id, deezer_artist_id),
           note = 'Waiting: existing artists are being filled in first.'
    where name_key = p_key and state = 'pending';
    return null;
  end if;
  if p_action = 'link' then
    v_artist := p_artist;
  else
    v_artist := coalesce((select id from artists where deezer_artist_id = p_deezer_id limit 1), sc_find_artist(g.name));
    if v_artist is null then
      -- A new page: only within today's allowance, and only once every
      -- artist here has been checked. Otherwise keep them for later.
      if sc_new_artists_left() <= 0 then
        update guest_artists set checked_at = now(), deezer_artist_id = coalesce(p_deezer_id, deezer_artist_id),
               note = 'Waiting: existing artists are being filled in first.'
        where name_key = p_key and state = 'pending';
        return null;
      end if;
      v_artist := trim(both '-' from lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'))
                  || '-' || substr(gen_random_uuid()::text, 1, 8));
      perform set_config('static_cuts.batch_id', '', true);
      perform sc_begin_batch('guests', 'New artist page: ' || v_name);
      insert into artists (id, name, status, deezer_artist_id) values (v_artist, v_name, 'ONGOING', p_deezer_id);
      insert into artist_additions (artist_id, name, source, note)
      values (v_artist, v_name, 'guest', g.songs || ' song' || case when g.songs = 1 then '' else 's' end || ' credited here');
    end if;
  end if;
  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('guests', 'Songs moved to ' || v_name || '''s page');
  perform sc_guest_move(p_key, v_artist);
  update guest_artists set state = case when p_action = 'link' then 'linked' else 'created' end, artist_id = v_artist,
         deezer_artist_id = coalesce(p_deezer_id, deezer_artist_id), songs = 0, checked_at = now(), note = null
  where name_key = p_key;
  return v_artist;
end;
$$;
revoke execute on function sc_guest_found(text, text, text, text, text, text, text) from public, anon, authenticated;

-- Each guest is looked at at most once a week (before, only while new pages
-- were on hold), so ones left pending above aren't picked again every run.
do $$
declare d text := replace(pg_get_functiondef('sc_guest_next(text,integer)'::regprocedure), E'\r\n', E'\n');
begin
  if position('not v_wait or g.checked_at' in d) > 0 then
    execute replace(d, 'and (not v_wait or g.checked_at is null or g.checked_at < now() - interval ''7 days'')',
                       'and (g.checked_at is null or g.checked_at < now() - interval ''7 days'')');
  end if;
end $$;

-- Twice as often (Deezer can take it).
select cron.alter_job(jobid, schedule := '8-59/10 * * * *') from cron.job where jobname = 'guest-artists';
