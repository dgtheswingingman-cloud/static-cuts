"use client";

// Most wanted: the unreleased songs people want most, for everyone or one
// artist. Vote with "want it" on a song's page or right here.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useIsAdmin, usePersonalUser } from "../useIsAdmin";

type Row = { track_id: string; title: string; artist_id: string; artist: string; release_status: string; votes: number; wanted: boolean | null };

function WantedInner() {
  const router = useRouter();
  const params = useSearchParams();
  const artistId = params.get("artist");
  const user = usePersonalUser();
  const isAdmin = useIsAdmin();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [artistName, setArtistName] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    supabase.rpc("rpc_most_wanted", { p_artist_id: artistId, p_limit: 100 }).then(({ data }) => setRows((data as Row[]) ?? []));
    if (artistId) supabase.from("artists").select("name").eq("id", artistId).maybeSingle().then(({ data }) => setArtistName(data?.name ?? null));
    else setArtistName(null);
  }, [artistId, user?.id]);

  async function toggle(r: Row) {
    if (!user) { router.push("/login"); return; }
    setBusy(r.track_id);
    const { data } = await supabase.rpc("rpc_toggle_wanted", { p_track_id: r.track_id });
    setBusy(null);
    if (data) setRows((prev) => (prev ?? []).map((x) => (x.track_id === r.track_id ? { ...x, wanted: data.wanted, votes: data.count } : x)));
  }

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push(artistId ? `/artist/${artistId}` : "/")}>← {artistName ?? "home"}</button>
      <h1 className="detail-name page-title">Most Wanted{artistName ? `: ${artistName}` : ""}</h1>
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        The unreleased songs fans want most. Vote with &quot;want it&quot; on any song that isn&apos;t out yet.
        {artistId && <> <Link href="/wanted" className="text-link">See every artist</Link>.</>}
      </div>
      {rows === null && <div className="empty-state">loading…</div>}
      {rows && rows.length === 0 && (
        <div className="empty-state">No votes yet. Open an unreleased song and press &quot;want it&quot; to start the list.</div>
      )}
      {rows?.map((r, i) => (
        <div key={r.track_id} className="review-row" style={{ gridTemplateColumns: "2.2em minmax(0, 1fr) auto" }}>
          <span className="comment-meta">{i + 1}</span>
          <div style={{ minWidth: 0 }}>
            <div className="review-row-title"><Link href={`/song/${r.track_id}`}>{r.title}</Link></div>
            <div className="review-row-meta">
              {!artistId && <Link href={`/artist/${r.artist_id}`}>{r.artist}</Link>}
              <span className="feature-tag">{r.release_status}</span>
              <span>{r.votes} vote{r.votes === 1 ? "" : "s"}</span>
            </div>
          </div>
          {!isAdmin && (
            <button className={`rating-chip ${r.wanted ? "active" : ""}`} disabled={busy === r.track_id} onClick={() => toggle(r)}>
              {r.wanted ? "✓ want it" : "want it"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default function WantedPage() {
  return (
    <Suspense fallback={<div className="wrap"><div className="empty-state">loading…</div></div>}>
      <WantedInner />
    </Suspense>
  );
}
