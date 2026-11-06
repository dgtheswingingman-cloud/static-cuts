-- The Claude version check runs every 2 minutes; with nothing left to check
-- it still read every song (~1.2 s a run). Stop early when there's nothing to do.
create index if not exists version_suggestions_ai_todo_idx on version_suggestions (track_id) where state = 'open' and ai_checked_at is null;
create index if not exists version_suggestions_open_idx on version_suggestions (state) where state = 'open';
do $do$
declare d text;
begin
  d := pg_get_functiondef('sc_version_ai_next'::regproc);
  if position('Nothing left to check' in d) = 0 then
    d := replace(d, '  with pick as (', '  -- Nothing left to check: stop here instead of reading every song.
  if not exists (select 1 from version_suggestions where state = ''open'' and ai_checked_at is null
                 and (ai_claim_at is null or ai_claim_at < now() - interval ''10 minutes'')) then
    return ''[]''::jsonb;
  end if;
  with pick as (');
    execute d;
  end if;
end $do$;
