-- "Publish to the web" Google Sheets links (/d/e/2PACX-.../pubhtml) work as
-- trackers too (ArtistGrid lists some that way); their id keeps the "e/".
create or replace function sc_parse_sheet_url(p_url text, out sheet_id text, out gid text)
returns record
language sql
immutable
as $$
  select substring(p_url from '/spreadsheets/d/(e/2PACX-[A-Za-z0-9_-]+|[A-Za-z0-9_-]{20,})'),
         coalesce(substring(p_url from '[#?&]gid=([0-9]+)'), '0');
$$;
