-- Automatic changes (Deezer, Apple, trackers...) are kept in the undo history
-- for 7 days instead of 14; they were two-thirds of the database. Changes
-- people made are untouched.
create or replace function sc_trim_undo()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  n int;
begin
  with gone as (
    delete from change_batches
    where created_by is null and created_at < now() - interval '7 days'
    returning 1
  )
  select count(*) into n from gone;
  return n;
end;
$function$;
