-- Nathan, 21 Nov ("go"): on 17 artist-producer pages (they also perform, so
-- not whole-page roles), relabel "Feature on X's song" song by song from the
-- Genius credits genius-credits has fetched:
--   page artist in featured artists -> real feature, left alone
--   in producers only               -> credit_role 'producer'
--   in writers only (not producers) -> credit_role 'writer'
--   no credit                       -> left alone
-- Same note wording as the 37 pages on 20 Nov (sc_credit_note). One undo batch
-- per run; a daily NIX step carries on as Genius checks the rest.

create or replace function public.sc_credit_relabel_checked()
returns int language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  create temp table _relabel on commit drop as
  select t.id, case when position(lower(a.name) in lower(coalesce(t.producers, ''))) > 0 then 'producer' else 'writer' end role, a.name page
  from tracks t join artists a on a.id = t.artist_id
  where a.name in ('A. G. Cook', 'Flying Lotus', 'Alex Somers', 'Calvin Harris', 'David Guetta', 'DJ Snake', 'Alesso', 'Steve Aoki',
                   'Major Lazer', 'Fred again..', 'Zach Hill', 'Eem Triplin', 'Diddy', 'DJ Khaled', 'Jon Bellion', 'Big K.R.I.T.', 'Kid Cudi')
    and t.notes ~ '^Feature on .*''s song\.' and t.credit_role is null and t.genius_checked_at is not null
    and position(lower(a.name) in lower(coalesce(t.featured_artists, ''))) = 0
    and (position(lower(a.name) in lower(coalesce(t.producers, ''))) > 0 or position(lower(a.name) in lower(coalesce(t.writers, ''))) > 0);
  select count(*) into n from _relabel;
  if n = 0 then return 0; end if;

  perform set_config('static_cuts.batch_id', '', true);
  perform sc_begin_batch('cleanup', '"Feature on" relabelled as produced/written by: ' || n || ' songs on artist-producer pages');
  update tracks t set
    credit_role = r.role,
    notes = sc_credit_note(r.role, substring(t.notes from '^Feature on (.*)''s song\.'), r.page)
      || coalesce(nullif(regexp_replace(t.notes, '^Feature on .*''s song\.', ''), ''), '')
  from _relabel r where t.id = r.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.sc_credit_relabel_checked() from public, anon, authenticated;

insert into public.nix_tasks (name, steps, every, max_every, at_time) values
  ('credit-relabel', '[{"name":"relabelled","sql":"public.sc_credit_relabel_checked()"}]', '1 day', '1 day', '05:11')
on conflict (name) do nothing;
update public.nix_tasks set next_at = date_trunc('day', now()) + interval '1 day' + time '05:11' where name = 'credit-relabel' and last_run_at is null;

-- No double full stop when the artist's name already ends in one ("H.E.R.").
create or replace function public.sc_credit_note(p_role text, p_main text, p_page text)
returns text language sql immutable set search_path to 'public' as $$
  select case p_role
    when 'producer' then 'Produced for ' || p_main || case when p_main like '%.' then '' else '.' end
    when 'label' then 'A song by ' || p_main || ', released on ' || p_page || case when p_page like '%.' then '' else '.' end
    when 'writer' then 'A song by ' || p_main || ', written by ' || p_page || case when p_page like '%.' then '' else '.' end
  end;
$$;
