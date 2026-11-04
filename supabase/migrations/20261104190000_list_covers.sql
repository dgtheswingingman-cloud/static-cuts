-- List covers: the owner can upload a picture for their list. Stored in the
-- covers bucket under list/<their id>/; the column only accepts a picture
-- from there.

alter table song_lists add column if not exists cover_url text;

do $$ begin
  alter table song_lists add constraint song_lists_cover_url_ours
    check (cover_url is null or cover_url like 'https://pcuyzaamcsegblrauxsa.supabase.co/storage/v1/object/public/covers/list/%');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Signed-in users upload list covers" on storage.objects for insert to authenticated
    with check (bucket_id = 'covers' and (storage.foldername(name))[1] = 'list' and (storage.foldername(name))[2] = (auth.uid())::text);
exception when duplicate_object then null; end $$;
