-- Discord: /album, and rating songs from Discord.
-- /link gives a one-time code (15 minutes) and a link to static-cuts.com/discord/link,
-- where a signed-in person ties their Discord account to Static-Cuts.
-- Then /rate <song> <1-10> rates as them.

create table if not exists discord_links (
  discord_id text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  linked_at timestamptz not null default now()
);
alter table discord_links enable row level security;

create table if not exists discord_link_codes (
  discord_id text primary key,
  code text not null unique,
  made_at timestamptz not null default now()
);
alter table discord_link_codes enable row level security;

-- The bot: a fresh code for this Discord user.
create or replace function sc_discord_link_code(p_secret text, p_discord text) returns text
language plpgsql security definer set search_path to 'public' as $$
declare c text;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  loop
    c := upper(substr(translate(encode(extensions.gen_random_bytes(8), 'base64'), '+/=0O1Il', ''), 1, 6));
    exit when length(c) = 6 and not exists (select 1 from discord_link_codes where code = c);
  end loop;
  insert into discord_link_codes (discord_id, code, made_at) values (p_discord, c, now())
  on conflict (discord_id) do update set code = excluded.code, made_at = excluded.made_at;
  return c;
end $$;

-- The site: link the signed-in person to the Discord account that asked for this code.
create or replace function rpc_discord_link(p_code text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare u uuid := auth.uid(); d text;
begin
  if u is null then raise exception 'Log in first.'; end if;
  select discord_id into d from discord_link_codes where code = upper(trim(coalesce(p_code, ''))) and made_at > now() - interval '15 minutes';
  if d is null then raise exception 'That code has run out or is wrong. Type /link in Discord again for a new one.'; end if;
  update discord_link_codes set made_at = now() - interval '1 day' where discord_id = d;  -- used up
  update discord_links set discord_id = d, linked_at = now() where user_id = u;
  if not found then
    insert into discord_links (discord_id, user_id) values (d, u)
    on conflict (discord_id) do update set user_id = excluded.user_id, linked_at = now();
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function rpc_my_discord_link() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from discord_links where user_id = auth.uid());
$$;

-- The bot: rate a song as the linked person.
create or replace function sc_discord_rate(p_secret text, p_discord text, p_track text, p_value int) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare u uuid; old smallint;
begin
  if p_secret is null or p_secret <> (select value from sc_private_settings where key = 'cron_secret') then raise exception 'not authorized'; end if;
  select user_id into u from discord_links where discord_id = p_discord;
  if u is null then return jsonb_build_object('ok', false, 'why', 'not linked'); end if;
  if p_value not between 1 and 10 then return jsonb_build_object('ok', false, 'why', 'score'); end if;
  select value into old from ratings where user_id = u and track_id = p_track;
  insert into ratings (user_id, track_id, value, updated_at) values (u, p_track, p_value, now())
  on conflict (user_id, track_id) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true, 'was', old,
    'name', (select display_name from profiles where id = u),
    'avg', (select round(avg_rating::numeric, 1) from track_rating_stats where track_id = p_track),
    'count', (select rating_count from track_rating_stats where track_id = p_track));
end $$;

revoke execute on function sc_discord_link_code(text, text), sc_discord_rate(text, text, text, int) from public, anon, authenticated;
revoke execute on function rpc_discord_link(text), rpc_my_discord_link() from public, anon;
grant execute on function rpc_discord_link(text), rpc_my_discord_link() to authenticated;
