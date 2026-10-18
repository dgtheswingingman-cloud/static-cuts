-- Comment reporting and anti-spam.
--
-- Reporting: anyone signed in can report a comment (spam, abuse, spoilers
-- of private info, off-topic). Three different people reporting it hides it
-- until a moderator looks (/review/comments): keep it (reports cleared) or
-- delete it. The author still sees their hidden comment, marked as hidden.
--
-- Anti-spam, checked when a comment is posted:
--   - at most 30 comments an hour per person (5 an hour for accounts less
--     than a day old)
--   - no posting the same text twice within 10 minutes
--   - accounts less than a day old can't post links
--   - 2,000 characters at most
-- Moderators aren't limited.

alter table comments add column if not exists hidden_at timestamptz;
alter table comments add column if not exists reviewed_at timestamptz;

create table if not exists comment_reports (
  comment_id uuid not null references comments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  reason text not null check (reason in ('spam', 'abuse', 'personal_info', 'off_topic', 'other')),
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table comment_reports enable row level security;
drop policy if exists comment_reports_read on comment_reports;
create policy comment_reports_read on comment_reports for select using (user_id = (select auth.uid()) or (select is_moderator()));
revoke insert, update, delete on comment_reports from anon, authenticated;

-- Hidden comments: only their author and moderators see them.
drop policy if exists "Public can read comments" on comments;
create policy "Public can read comments" on comments for select
  using (hidden_at is null or user_id = (select auth.uid()) or (select is_moderator()));

-- Checks on new comments.
create or replace function comments_anti_spam()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_age interval;
  v_recent int;
begin
  if is_moderator() then return new; end if;
  new.body := trim(new.body);
  if length(new.body) = 0 then raise exception 'Write something first.'; end if;
  if length(new.body) > 2000 then raise exception 'Comments can be up to 2,000 characters.'; end if;
  new.hidden_at := null;
  new.reviewed_at := null;

  select now() - created_at into v_age from auth.users where id = new.user_id;
  select count(*) into v_recent from comments where user_id = new.user_id and created_at > now() - interval '1 hour';
  if v_age < interval '1 day' then
    if v_recent >= 5 then raise exception 'New accounts can post 5 comments an hour. Try again a bit later.'; end if;
    if new.body ~* '(https?://|www\.|\.(com|net|org|io|gg|ru|xyz)\b)' then
      raise exception 'New accounts can''t post links yet. Try again tomorrow.';
    end if;
  elsif v_recent >= 30 then
    raise exception 'That''s 30 comments in the last hour. Take a breather and try again soon.';
  end if;
  if exists (select 1 from comments where user_id = new.user_id and lower(body) = lower(new.body)
             and created_at > now() - interval '10 minutes') then
    raise exception 'You just posted that.';
  end if;
  return new;
end;
$$;
drop trigger if exists comments_anti_spam on comments;
create trigger comments_anti_spam before insert on comments for each row execute function comments_anti_spam();

-- Report a comment. Returns whether it's now hidden.
create or replace function rpc_report_comment(p_comment uuid, p_reason text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c comments%rowtype;
  v_reports int;
begin
  if auth.uid() is null or is_oauth_client() then raise exception 'Sign in to report comments.'; end if;
  select * into c from comments where id = p_comment;
  if c.id is null then raise exception 'That comment is gone.'; end if;
  if c.user_id = auth.uid() then raise exception 'You can delete your own comment instead.'; end if;
  if (select count(*) from comment_reports where user_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'That''s a lot of reports today. A moderator will catch up.';
  end if;
  insert into comment_reports (comment_id, user_id, reason, note)
  values (p_comment, auth.uid(), p_reason, nullif(trim(p_note), ''))
  on conflict (comment_id, user_id) do update set reason = excluded.reason, note = excluded.note;
  select count(*) into v_reports from comment_reports where comment_id = p_comment;
  -- Three people, or any moderator, hides it until it's reviewed (a comment
  -- a moderator already kept needs three new reports).
  if (v_reports >= 3 or is_moderator()) and c.hidden_at is null
     and (c.reviewed_at is null or (select count(*) from comment_reports where comment_id = p_comment and created_at > c.reviewed_at) >= 3) then
    update comments set hidden_at = now() where id = p_comment;
    return jsonb_build_object('hidden', true);
  end if;
  return jsonb_build_object('hidden', c.hidden_at is not null);
end;
$$;

-- Moderators: reported comments, most-reported first.
create or replace function admin_reported_comments()
returns table (comment_id uuid, body text, author_id uuid, author text, created_at timestamptz, hidden_at timestamptz,
               track_id text, track_title text, artist_id text, reports bigint, reasons text[], notes text[], author_comments bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.id, c.body, c.user_id, coalesce(p.display_name, 'someone'), c.created_at, c.hidden_at,
         c.track_id, t.title, t.artist_id, count(r.*), array_agg(distinct r.reason), array_remove(array_agg(r.note), null),
         (select count(*) from comments x where x.user_id = c.user_id)
  from comments c
  join comment_reports r on r.comment_id = c.id and (c.reviewed_at is null or r.created_at > c.reviewed_at)
  left join profiles p on p.id = c.user_id
  left join tracks t on t.id = c.track_id
  where is_moderator()
  group by c.id, p.display_name, t.title, t.artist_id
  order by c.hidden_at is null, count(r.*) desc, c.created_at desc
  limit 200;
$$;

-- Keep (clear the reports and show it) or delete.
create or replace function admin_handle_comment(p_comment uuid, p_action text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_moderator() then raise exception 'not authorized'; end if;
  if p_action = 'keep' then
    update comments set hidden_at = null, reviewed_at = now() where id = p_comment;
  elsif p_action = 'delete' then
    perform sc_begin_batch('moderation', 'Comment removed');
    delete from comments where id = p_comment;
  else
    raise exception 'unknown action';
  end if;
end;
$$;

revoke execute on function comments_anti_spam() from public, anon, authenticated;
revoke execute on function rpc_report_comment(uuid, text, text), admin_reported_comments(), admin_handle_comment(uuid, text) from public, anon;
grant execute on function rpc_report_comment(uuid, text, text), admin_reported_comments(), admin_handle_comment(uuid, text) to authenticated;
