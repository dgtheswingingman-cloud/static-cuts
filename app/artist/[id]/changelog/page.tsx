"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ArtistChangelog from "../ArtistChangelog";

export default function ArtistChangelogPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [artistName, setArtistName] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from("artists").select("name").eq("id", id).single();
      setArtistName(data?.name ?? null);
    }
    load();
  }, [id]);

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push(`/artist/${id}`)}>
        ← back to {artistName ?? "artist"}
      </button>
      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>Changelog</h1>
      <div className="detail-meta" style={{ marginBottom: 20 }}>
        Approved and rejected submissions for {artistName ?? "this artist"} — pending items stay
        in the review queue until resolved.
      </div>
      <ArtistChangelog artistId={id} limit={100} />
    </div>
  );
}
