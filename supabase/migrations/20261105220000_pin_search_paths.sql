-- Security advisor: fix the search path on four helper functions.
alter function sc_aotw_monday(date) set search_path to 'public';
alter function sc_artist_tag(text) set search_path to 'public';
alter function sc_profile_id(text, text) set search_path to 'public';
alter function sc_search_text(text, text, text, text) set search_path to 'public';
