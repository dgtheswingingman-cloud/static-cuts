-- Clean-up after importing the ArtistGrid trackers (31 Oct).
--
-- Everything here runs as one batch, so it can be undone from undo history.
--
-- 1. Songs from tabs that aren't song lists (fan edits, compilations,
--    instrumentals, radio clips, museum pieces, account names, eras, live
--    shows, beats made for others, project lists) are removed, and those
--    tabs are removed from the imported sheets so they aren't read again.
-- 2. Edward Skeletrix's "Skeletrix Island Radio" clips (they came in through
--    his Recent tab too) are removed.
-- 3. Rows that were the sheet's own notices, credits, links or headings
--    (e.g. "THIS SPREADSHEET IS INTENDED...", "Join ... Hub", a mega.nz
--    folder link) are removed, on every imported sheet.
-- 4. "Recent" tabs from today's batch (they only repeat the main tabs) are
--    removed, as is Skeletrix's Recent tab (it brought in the radio clips).
-- 5. Album values that aren't albums are cleared: "?", "Unknown", "Other",
--    "0 Total Edits", "tracker is created by...", and so on. A year on its
--    own ("2022") moves into the notes as "Era: 2022.". "Released on a
--    Alternate Soundcloud Account: @x" and 2hollis's alt account names move
--    into the notes too.
-- 6. Links to leak sites in notes (leaked.cx, Telegram, Discord, mega...)
--    are taken out.
-- 7. The Kanye tracker's tabs get a proper name (the sheet is titled "Copy of
--    Suzy Tracker WE LOVE MILO"), and the three big tabs that timed out are
--    queued to be read again (sheet-import now reads big tabs in pieces).

do $$
declare
  v_batch uuid := sc_begin_batch('cleanup', 'ArtistGrid tracker clean-up');
  junk_tabs uuid[] := array[
    '9c82850e-d3fa-413b-8e9c-48da309db5d2', -- Destroy Lonely: Edits
    '4af45dbb-53ef-40a2-8c5a-936d0dad99e6', -- Edward Skeletrix: Museum Exhibitions
    '35dd56b7-6226-49f6-bd71-db3cb71e36ad', -- Edward Skeletrix: Skeletrix Island Radio
    '0527c69a-5478-4173-8085-96d1e5050732', -- Edward Skeletrix: Media
    '7310036a-1eac-445d-851d-7d911836b755', -- fakemink: drilldance (mixes, slowed, others' songs)
    'c591e1da-2cfe-4912-a183-620cd5ff6dcb', -- LAZER DIM 700: Projects
    '4a8915ea-acd0-4846-abbc-fe225e4b5983', -- Lil Uzi Vert: Edits
    '255bb7f6-3a18-4623-b756-2b19ea0b3f6b', -- Lil Uzi Vert: Comps
    '2589be36-b920-4afa-8c62-e32e7c8cfd77', -- Nine Vicious: Instrumentals
    '3c7cf7f7-67ae-4da1-8032-e5fd2d2f425e', -- OsamaSon: Accounts
    '23e1d665-c573-40bd-bb0a-50191ff37e81', -- OsamaSon: Eras
    'ef737145-77c3-4e4c-a3cd-f70df1e8337c', -- OsamaSon: Live Performances
    'd7678d3b-5627-4d97-9c23-641478c9c915', -- OsamaSon: Production
    '989191a5-a11e-4225-b141-4d2d9cc6eb2d'  -- XXXTENTACION: Edits & Comps
  ]::uuid[];
  skip_tabs uuid[] := array[
    'fb8a101f-c396-46b1-800c-9261cd9d1110', -- Edward Skeletrix: Recent
    '5358ab21-e1a5-4abd-bfe7-ffb46eff72c7', -- Che: Recent
    '536158e9-d3e2-4284-a4ce-df09b2fb1abd', -- HXG: Recent
    'c508cdfa-8974-4a25-a789-54108298f3ab', -- Nettspend: Recent
    '1d3f96a4-40c0-413f-afd4-3c5beee34eeb', -- Nine Vicious: Recent
    '68cbe696-b4d2-4e82-8336-fa366a09f1e8', -- OsamaSon: Recent
    'da0b837c-f9fe-464b-82b2-1da7aef68a91', -- untiljapan: Recent
    '1bf11acf-926f-4b93-bde2-ed8f842a238f'  -- Yabujin: Recent
  ]::uuid[];
  gone text[];
  n1 int; n5 int; n6 int;
begin
  -- 1-3. Songs that aren't songs.
  gone := array(select t.id from tracks t
  where t.source = 'sheet' and t.source_url in (select url from sheet_sources)
    and (
      t.source_url in (select url from sheet_sources where id = any (junk_tabs))
      or (t.artist_id = 'edward-skeletrix-158a0c3e' and t.album ~* '(skeletrix island radio|islvnd rvdix)')
      or length(t.title) > 90
      or t.title ~* '(https?://|www\.|spreadsheet|\mtracker\M|right-click|sort sheet|\mjoin\M.*\mhub\M|^snippets?$|^og files?\M|og file: placeholder|\minterview$|^credits?$|notes to editors|editors/compilers|^\(.{1,3}\):|=\s*these are)'
    ));
  n1 := cardinality(gone);
  -- Versions pointing at a removed song stand on their own again.
  update tracks set parent_track_id = null where parent_track_id = any (gone);
  delete from tracks where id = any (gone);

  -- 1 & 4. Tabs that shouldn't be read again.
  delete from sheet_sources where id = any (junk_tabs) or id = any (skip_tabs);

  -- 2hollis's alt accounts: the "album" is the account the song was posted on.
  update tracks t set
    notes = concat_ws(E'\n', nullif(t.notes, ''), 'Posted on the alt account "' || t.album || '".'),
    album = null
  from sheet_sources s
  where s.url = t.source_url and s.artist_id = '2hollis' and s.tab_name ilike '%alt accounts%'
    and t.album is not null;

  -- 5. Album values that aren't albums.
  update tracks t set
    notes = concat_ws(E'\n', nullif(t.notes, ''),
      case
        when t.album ~ '^(19|20)\d\d$' then 'Era: ' || t.album || '.'
        when t.album ~* '^released on a alternate soundcloud account' then initcap(left(t.album, 1)) || substr(t.album, 2) || '.'
      end),
    album = null
  from sheet_sources s
  where s.url = t.source_url and t.source = 'sheet'
    and (t.album ~ '^(19|20)\d\d$'
      or t.album ~* '^released on a alternate soundcloud account'
      or t.album ~* '^(\?+|unknown|other|n/?a|none|tbd|-+|misc|unreleased|released|credits?|notes to editors|snippets? (&|and) partials)$'
      or t.album ~* '(total edits|og file\(s\)|og files for|tracker is created|^\d+ (released|unreleased|songs?)$)');
  get diagnostics n5 = row_count;

  -- 6. Leak-site links in notes.
  update tracks t set notes = nullif(btrim(regexp_replace(t.notes,
      'https?://(www\.)?(leaked\.cx|t\.me|telegram\.me|discord\.gg|discord\.com|mega\.nz|pillowcase\.su|pillows\.su|krakenfiles\.com|files\.yetracker\.org|drive\.google\.com|dropbox\.com|mediafire\.com|gofile\.io|imgur\.com)[^\s,)]*',
      '', 'gi')), '')
  where t.source = 'sheet'
    and t.notes ~* 'https?://(www\.)?(leaked\.cx|t\.me|telegram\.me|discord\.gg|discord\.com|mega\.nz|pillowcase\.su|pillows\.su|krakenfiles\.com|files\.yetracker\.org|drive\.google\.com|dropbox\.com|mediafire\.com|gofile\.io|imgur\.com)';
  get diagnostics n6 = row_count;

  -- 7. Kanye tracker name, and re-read the big tabs that timed out.
  update sheet_sources set title = replace(title, 'Copy of Suzy Tracker WE LOVE MILO', 'Kanye West Tracker')
  where title like 'Copy of Suzy Tracker WE LOVE MILO%';
  update sheet_sources set next_check_at = now(), last_result = null, last_synced_at = null
  where id in ('cb8b3a0b-3f7e-4ebc-84ec-aef1b8da2b41', 'baec33fc-277d-40cc-87bb-239f8e1e73f3', '5a7ce43f-3e3c-4962-b3ca-a21dd053ced8');

  raise notice 'Removed % non-songs; cleared % album values; took leak links out of % notes.', n1, n5, n6;
end $$;
