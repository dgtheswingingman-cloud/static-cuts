"use client";

// Photos of the artist. Songs with no cover of their own (and no fan cover)
// show one of these, spread across them so they don't all share one
// picture, so more photos = more variety. Anyone signed in can add one;
// moderators and whoever added a photo can remove it.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { shrinkImage } from "@/lib/shrinkImage";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";
import { thumb } from "@/lib/thumb";

type Photo = { id: string; url: string; added_by: string | null };

export default function ArtistPhotos({ artistId, artistName }: { artistId: string; artistName: string }) {
  const { user } = useAuth();
  const canModerate = useIsModerator();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("artist_photos").select("id, url, added_by").eq("artist_id", artistId).order("created_at");
    setPhotos((data as Photo[]) ?? []);
  }
  useEffect(() => { load(); }, [artistId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(file: File) {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await shrinkImage(file, 1200);
      const path = `artist/${user.id}/${artistId}-${Date.now()}.jpg`;
      const { error: up } = await supabase.storage.from("covers").upload(path, blob, { contentType: "image/jpeg" });
      if (up) throw new Error(up.message);
      const url = supabase.storage.from("covers").getPublicUrl(path).data.publicUrl;
      const { error: err } = await supabase.rpc("rpc_artist_photo_add", { p_artist: artistId, p_url: url });
      if (err) throw new Error(err.message);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function remove(p: Photo) {
    if (!confirm("Remove this photo?")) return;
    await supabase.rpc("admin_artist_photo_remove", { p_photo: p.id });
    await load();
  }

  if (!photos) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <button className="rating-clear" onClick={() => setOpen(!open)}>
        photos ({photos.length}) {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="comments-panel" style={{ marginTop: 8 }}>
          <div className="comment-meta" style={{ marginBottom: 8 }}>
            Songs by {artistName} with no cover show one of these photos. More photos means fewer songs share one.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {photos.map((p) => (
              <div key={p.id} style={{ position: "relative" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb(p.url)} alt="" width={72} height={72} style={{ objectFit: "cover" }} />
                {(canModerate || (user && p.added_by === user.id)) && (
                  <button className="rating-clear" style={{ position: "absolute", top: 0, right: 2 }} onClick={() => remove(p)} title="Remove">×</button>
                )}
              </div>
            ))}
            {user && (
              <label className="tab" style={{ cursor: "pointer" }}>
                {busy ? "uploading…" : "+ add a photo"}
                <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) add(f); }} />
              </label>
            )}
          </div>
          {error && <div className="comment-meta error-text" style={{ marginTop: 6 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
