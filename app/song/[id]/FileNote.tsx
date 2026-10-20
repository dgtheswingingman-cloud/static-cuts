"use client";

// Leaked files: the public only learns that a file is known to exist; the
// owner also sees the private link (kept off the site's listen buttons).

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useIsOwner } from "../../useIsAdmin";

export default function FileNote({ trackId }: { trackId: string }) {
  const isOwner = useIsOwner();
  const [hasFile, setHasFile] = useState(false);
  const [file, setFile] = useState<{ url: string; source: string | null } | null>(null);

  useEffect(() => {
    supabase.from("tracks").select("has_file").eq("id", trackId).maybeSingle()
      .then(({ data }) => setHasFile(!!(data as { has_file?: boolean } | null)?.has_file));
  }, [trackId]);

  useEffect(() => {
    if (!isOwner || !hasFile) { setFile(null); return; }
    supabase.rpc("owner_track_file", { p_track_id: trackId }).then(({ data }) => setFile((data as typeof file) ?? null));
  }, [isOwner, hasFile, trackId]);

  if (!hasFile) return null;
  return (
    <div className="comment-meta" style={{ marginTop: 6 }}>
      A file of this song is known to exist. Static Cuts doesn&apos;t link to leaked files.
      {file && (
        <div style={{ marginTop: 4 }}>
          <span className="feature-tag">only you see this</span>{" "}
          <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-link" style={{ overflowWrap: "anywhere" }}>{file.url}</a>
        </div>
      )}
    </div>
  );
}
