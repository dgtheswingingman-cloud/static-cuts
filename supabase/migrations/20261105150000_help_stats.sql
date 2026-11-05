-- Help wanted: how much you've helped, how many votes settle a link, and how
-- much of the archive has a listen link.
create or replace function public.rpc_help_stats()
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'helped', case when auth.uid() is null then null else
      (select count(*) from track_link_candidate_votes where user_id = auth.uid())
      + (select count(*) from version_votes where user_id = auth.uid())
      + (select count(*) from submissions where submitted_by = auth.uid()) end,
    'week', case when auth.uid() is null then null else
      (select count(*) from version_votes where user_id = auth.uid() and created_at > now() - interval '7 days')
      + (select count(*) from submissions where submitted_by = auth.uid() and created_at > now() - interval '7 days') end,
    'link_votes', (select case when enabled then link_votes end from auto_approve_settings where id = 1),
    'linked_pct', (select round(100.0 * count(*) filter (where coalesce(spotify_url, apple_url, deezer_url) is not null) / greatest(count(*), 1))
                   from tracks where parent_track_id is null)
  );
$$;
grant execute on function public.rpc_help_stats() to anon, authenticated;
