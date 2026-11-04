-- Comments and 1-10 ratings on lists (like songs). Anyone who can see a list
-- can comment; the commenter, the list's owner and moderators can remove a
-- comment. You rate other people's lists, not your own. Same spam limits as
-- song comments.

create table if not exists song_list_comments (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references song_lists(id) on delete cascade,
  user_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  hidden_at timestamptz
);
create index if not exists song_list_comments_list on song_list_comments (list_id, created_at desc);

create table if not exists song_list_ratings (
  list_id uuid not null references song_lists(id) on delete cascade,
  user_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  value smallint not null check (value between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (list_id, user_id)
);

alter table song_list_comments enable row level security;
alter table song_list_ratings enable row level security;

create or replace function sc_list_visible(p_list uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from song_lists l where l.id = p_list and (l.is_public or l.owner_id = auth.uid()));
$$;

create policy slc_read on song_list_comments for select using ((hidden_at is null and sc_list_visible(list_id)) or is_moderator());
create policy slc_add on song_list_comments for insert to authenticated
  with check (user_id = auth.uid() and sc_list_visible(list_id) and not is_oauth_client());
create policy slc_remove on song_list_comments for delete to authenticated
  using (user_id = auth.uid() or is_moderator() or exists (select 1 from song_lists l where l.id = list_id and l.owner_id = auth.uid()));

create policy slr_own on song_list_ratings for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and sc_list_visible(list_id) and not is_oauth_client()
    and not exists (select 1 from song_lists l where l.id = list_id and l.owner_id = auth.uid()));

create or replace function song_list_comments_anti_spam() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_age interval; v_recent int;
begin
  if is_moderator() then return new; end if;
  new.body := trim(new.body);
  if length(new.body) = 0 then raise exception 'Write something first.'; end if;
  if length(new.body) > 2000 then raise exception 'Comments can be up to 2,000 characters.'; end if;
  new.hidden_at := null;
  select now() - created_at into v_age from auth.users where id = new.user_id;
  select (select count(*) from song_list_comments where user_id = new.user_id and created_at > now() - interval '1 hour')
       + (select count(*) from comments where user_id = new.user_id and created_at > now() - interval '1 hour') into v_recent;
  if v_age < interval '1 day' then
    if v_recent >= 5 then raise exception 'New accounts can post 5 comments an hour. Try again a bit later.'; end if;
    if new.body ~* '(https?://|www\.|\.(com|net|org|io|gg|ru|xyz)\b)' then
      raise exception 'New accounts can''t post links yet. Try again tomorrow.';
    end if;
  elsif v_recent >= 30 then
    raise exception 'That''s 30 comments in the last hour. Take a breather and try again soon.';
  end if;
  if exists (select 1 from song_list_comments where user_id = new.user_id and lower(body) = lower(new.body)
             and created_at > now() - interval '10 minutes') then
    raise exception 'You just posted that.';
  end if;
  return new;
end $$;
create trigger song_list_comments_anti_spam before insert on song_list_comments for each row execute function song_list_comments_anti_spam();

-- A list's rating: the average and count, and yours.
create or replace function rpc_list_rating(p_list uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not sc_list_visible(p_list) then null else jsonb_build_object(
    'avg', (select round(avg(value)::numeric, 1) from song_list_ratings where list_id = p_list),
    'count', (select count(*) from song_list_ratings where list_id = p_list),
    'mine', (select value from song_list_ratings where list_id = p_list and user_id = auth.uid())) end;
$$;
grant execute on function rpc_list_rating(uuid) to anon, authenticated;
grant select, insert, delete on song_list_comments to authenticated;
grant select on song_list_comments to anon;
grant select, insert, update, delete on song_list_ratings to authenticated;
