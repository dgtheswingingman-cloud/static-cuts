"use client";

// Admin: merge this artist page into another one (admin_merge_artists).
// Everything moves to the other page, this page's name becomes one of its
// nicknames, and this page is removed.
// mode="report": anyone signed in can report that this page is the same
// artist as another one (report_same_artist); an admin reviews it.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Option = { id: string; name: string };

export default function MergeArtist({ artistId, artistName, onClose, mode = "merge" }: {
  artistId: string; artistName: string; onClose: () => void; mode?: "merge" | "report";
}) {
  const report = mode === "report";
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [target, setTarget] = useState<Option | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const words = q.trim().replace(/[%_,()\\]/g, " ").trim();
    if (words.length < 2 || target) { setOptions([]); return; }
    const t = setTimeout(() => {
      supabase.from("artists").select("id, name").ilike("name", `%${words}%`).neq("id", artistId).order("name").limit(8)
        .then(({ data }) => setOptions((data as Option[]) ?? []));
    }, 250);
    return () => clearTimeout(t);
  }, [q, target, artistId]);

  async function merge() {
    if (!target) return;
    setBusy(true); setError(null);
    if (report) {
      const { error: err } = await supabase.rpc("report_same_artist", { p_artist: artistId, p_same_as: target.id, p_note: note || null });
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSent(true);
      return;
    }
    const { error: err } = await supabase.rpc("admin_merge_artists", { p_from: artistId, p_into: target.id });
    setBusy(false);
    if (err) { setError(err.message); return; }
    router.push(`/artist/${target.id}`);
  }

  return (
    <div className="comments-panel" style={{ maxWidth: 560, marginBottom: 14 }}>
      {report ? (
        <div className="comment-meta" style={{ marginBottom: 8 }}>
          Is <strong>{artistName}</strong> the same artist as another page here (a different spelling, an old name, or
          two names joined together)? Pick the other page and an admin will check it and merge them.
        </div>
      ) : (
      <div className="comment-meta" style={{ marginBottom: 8 }}>
        Merge <strong>{artistName}</strong> into another artist: all its songs, features, followers and links move there,
        &ldquo;{artistName}&rdquo; becomes one of their nicknames, and this page is removed. If both pages have the same
        song, the duplicates page will offer to merge them.
      </div>
      )}
      {sent ? (
        <div className="comment-body">Thanks, sent. An admin will check it.</div>
      ) : !target ? (
        <>
          <input className="search-input" style={{ width: "100%", marginBottom: 8 }} autoFocus placeholder={report ? "Same artist as… (type a name)" : "Merge into… (type a name)"}
            value={q} onChange={(e) => setQ(e.target.value)} />
          {options.map((o) => (
            <button key={o.id} className="tab" style={{ display: "block", marginBottom: 6 }} onClick={() => setTarget(o)}>{o.name}</button>
          ))}
        </>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {report ? (
            <>
              <span className="comment-body"><strong>{artistName}</strong> is the same artist as <strong>{target.name}</strong></span>
              <input className="search-input" style={{ width: "100%" }} maxLength={300} placeholder="Anything that helps? (optional)"
                value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="tab" disabled={busy} onClick={merge}>{busy ? "sending…" : "send report"}</button>
            </>
          ) : (
            <>
              <span className="comment-body">Merge <strong>{artistName}</strong> into <strong>{target.name}</strong>?</span>
              <button className="tab danger-tab" disabled={busy} onClick={merge}>{busy ? "merging…" : "yes, merge"}</button>
            </>
          )}
          <button className="tab" disabled={busy} onClick={() => setTarget(null)}>pick another</button>
        </div>
      )}
      <button className="rating-clear" style={{ marginTop: 8 }} onClick={onClose}>{sent ? "close" : "cancel"}</button>
      {error && <div className="comment-meta error-text" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
}
