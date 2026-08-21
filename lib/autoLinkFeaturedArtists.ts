import { supabase } from "./supabase";

// Parses free-text featured-artist names (comma/and/& separated) and
// links each one to the given track -- creating the artist on the fly if
// they're not already in the archive. Shared between admin's direct
// add/edit flows and submission approval, so both produce identical
// results instead of two systems that could quietly drift apart.
export async function autoLinkFeaturedArtists(trackId: string, text: string) {
  const names = text.split(/,|&| and /i).map((s) => s.trim()).filter(Boolean);
  for (const name of names) {
    const { data: matches } = await supabase.from("artists").select("id").ilike("name", name).limit(1);
    let targetArtistId = matches && matches.length > 0 ? matches[0].id : null;
    if (!targetArtistId) {
      const { data: createdId } = await supabase.rpc("admin_create_artist", { p_name: name });
      targetArtistId = createdId as string | null;
    }
    if (targetArtistId) {
      await supabase.rpc("admin_add_track_appearance", { p_track_id: trackId, p_artist_id: targetArtistId });
    }
  }
}
