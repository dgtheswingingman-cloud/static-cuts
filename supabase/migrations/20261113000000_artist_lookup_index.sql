-- Looking up an artist by name (sc_find_artist) tidied every artist's name
-- on each call: ~110 ms per name that isn't an artist, so Local Cuts' folder
-- and title look-ups (300 names a call) ran past the 8 s limit. With this
-- index the same 300 names take ~0.4 s.
create index if not exists artists_norm_name_idx on public.artists (public.sc_normalize_title(name));
analyze public.artists;
