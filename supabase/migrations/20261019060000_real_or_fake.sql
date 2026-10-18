-- Real or fake? Votes on unreleased songs (rumoured, teased, snippet,
-- leaked): is this really the artist, or a fake/AI/mislabelled leak?
--
-- One vote per person per song; individual votes are private, totals are
-- public. A song is "disputed" once at least 5 people have voted and at
-- least 40% say fake.

create table if not exists authenticity_votes (
  track_id text not null references tracks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  real boolean not null,
  created_at timestamptz not null default now(),
  primary key (track_id, user_id)
);
create index if not exists authenticity_votes_user_idx on authenticity_votes (user_id);
alter table authenticity_votes enable row level security;
drop policy if exists authenticity_votes_own on authenticity_votes;
create policy authenticity_votes_own on authenticity_votes for select using (user_id = (select auth.uid()));
revoke insert, update, delete on authenticity_votes from anon, authenticated;

-- Merged songs keep their votes.
create or replace function authenticity_votes_follow_merge()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into authenticity_votes (track_id, user_id, real, created_at)
  select new.new_track_id, v.user_id, v.real, v.created_at
  from authenticity_votes v where v.track_id = new.old_track_id
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists authenticity_votes_follow_merge on track_redirects;
create trigger authenticity_votes_follow_merge before insert on track_redirects
for each row execute function authenticity_votes_follow_merge();

-- Totals (and the viewer's own vote) for a set of songs.
create or replace function rpc_authenticity(p_track_ids text[])
returns table (track_id text, real_votes int, fake_votes int, my_vote boolean, disputed boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select v.track_id,
         count(*) filter (where v.real)::int,
         count(*) filter (where not v.real)::int,
         bool_or(v.real) filter (where v.user_id = auth.uid()),
         count(*) >= 5 and count(*) filter (where not v.real) * 10 >= count(*) * 4
  from authenticity_votes v
  where v.track_id = any (p_track_ids[1:1000])
  group by v.track_id;
$$;

-- Vote: p_real true = real, false = fake, null = take my vote back.
create or replace function rpc_vote_authenticity(p_track_id text, p_real boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
begin
  if auth.uid() is null or is_oauth_client() then raise exception 'sign in to vote'; end if;
  select coalesce(release_status, 'unconfirmed') into v_status from tracks where id = p_track_id;
  if v_status is null then raise exception 'song not found'; end if;
  if p_real is null then
    delete from authenticity_votes where track_id = p_track_id and user_id = auth.uid();
    return;
  end if;
  if v_status not in ('rumored', 'teased', 'snippet', 'leaked') then
    raise exception 'only unreleased songs can be voted on';
  end if;
  insert into authenticity_votes (track_id, user_id, real) values (p_track_id, auth.uid(), p_real)
  on conflict (track_id, user_id) do update set real = excluded.real, created_at = now();
end;
$$;

revoke execute on function rpc_authenticity(text[]), rpc_vote_authenticity(text, boolean) from public;
grant execute on function rpc_authenticity(text[]) to anon, authenticated;
grant execute on function rpc_vote_authenticity(text, boolean) to authenticated;
revoke execute on function authenticity_votes_follow_merge() from public, anon, authenticated;
