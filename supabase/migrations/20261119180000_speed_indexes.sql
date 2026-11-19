-- Two slow everyday reads, made quick with indexes (no data changes).
--
-- 1. Home page "Just added": newest main songs with a cover. Was a full scan
--    of tracks (0.5-1.5 s on every home visit).
create index if not exists tracks_just_added_idx on tracks (created_at desc)
  where parent_track_id is null and cover_url is not null and created_at is not null;

-- 2. Search "Producers": producers ilike '%name%'. Was a full scan (~300 ms).
create index if not exists tracks_producers_trgm_idx on tracks using gin (producers extensions.gin_trgm_ops)
  where producers is not null;
