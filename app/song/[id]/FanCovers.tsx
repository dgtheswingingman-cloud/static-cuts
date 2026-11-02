"use client";

// For songs with no art of their own: pictures fans have added, most-voted
// first (the top one is the song's cover). Anyone signed in can add one
// (up to 3 per song) and vote. Moderators and the person who added a
// picture can remove it.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { shrinkImage } from "@/lib/shrinkImage";
import { useAuth } from "../../AuthProvider";
import { useIsModerator } from "../../useIsAdmin";

type Cover = { id: string; url: string; votes: number; mine: boolean; voted: boolean; by_name: string | null };

export default function FanCovers({ trackId, onChange }: { trackId: string; onChange?: () => void }) {
  const { user } = useAuth();
  const canModerate = useIsModerator();
  const [covers, setCovers] = useState<Cover[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.rpc("rpc_fan_covers", { p_track: trackId });
    setCovers((data as Cover[]) ?? []);
  }
  useEffect(() => { load(); }, [trackId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(file: File) {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await shrinkImage(file);
      const path = `fan/${user.id}/${trackId}-${Date.now()}.jpg`;
      const { error: up } = await supabase.storage.from("covers").upload(path, blob, { contentType: "image/jpeg" });
      if (up) throw new Error(up.message);
      const url = supabase.storage.from("covers").getPublicUrl(path).data.publicUrl;
      const { error: err } = await supabase.rpc("rpc_fan_cover_add", { p_track: trackId, p_url: url });
      if (err) throw new Error(err.message);
      await load();
      onChange?.();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function vote(c: Cover) {
    if (!user) return;
    await supabase.rpc("rpc_fan_cover_vote", { p_cover: c.id, p_on: !c.voted });
    await load();
    onChange?.();
  }

  async function remove(c: Cover) {
    if (!confirm("Remove this picture?")) return;
    await supabase.rpc("admin_fan_cover_remove", { p_cover: c.id });
    await load();
    onChange?.();
  }

  return (
    <div className="fan-covers">
      <div className="section-label">Cover art</div>
      <div className="comment-meta" style={{ marginBottom: 8 }}>
        This song has no official cover yet.{" "}
        {covers && covers.length > 0 ? "Fans' picks below: the most-voted one is shown." : "Got a good picture for it? Add one."}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
        {(covers ?? []).map((c, i) => (
          <div key={c.id} style={{ width: 92 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.url} alt="" width={92} height={92} style={{ objectFit: "cover", outline: i === 0 ? "2px solid var(--bone)" : undefined }} />
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
              <button className={`rating-clear ${c.voted ? "on" : ""}`} disabled={!user} onClick={() => vote(c)} title={user ? (c.voted ? "Take back your vote" : "Vote for this one") : "Sign in to vote"}>
                {c.voted ? "▲" : "△"} {c.votes}
              </button>
              {(c.mine || canModerate) && <button className="rating-clear" onClick={() => remove(c)} title="Remove">×</button>}
            </div>
          </div>
        ))}
        {user ? (
          <label className="tab" style={{ cursor: "pointer", alignSelf: "center" }}>
            {busy ? "uploading…" : "+ add a cover"}
            <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) add(f); }} />
          </label>
        ) : (
          <Link href="/login" className="text-link comment-meta" style={{ alignSelf: "center" }}>Sign in to add or vote</Link>
        )}
      </div>
      {error && <div className="comment-meta error-text" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
}
