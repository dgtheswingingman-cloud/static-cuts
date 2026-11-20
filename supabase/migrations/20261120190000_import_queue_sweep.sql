-- Nathan approved 20 Nov: once a day, dismiss open import suggestions whose
-- exact song is now on the artist's page (added another way after being
-- suggested). Restorable from the import review page.
create or replace function public.sc_import_queue_sweep()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  update import_suggestions s set state = 'dismissed', decided_at = now()
  where s.state = 'open'
    and exists (select 1 from tracks t where t.artist_id = s.artist_id and sc_title_key(t.title) = s.title_key);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.sc_import_queue_sweep() from public, anon, authenticated;

select cron.schedule('import-queue-sweep', '17 4 * * *', $$select public.sc_import_queue_sweep()$$);
