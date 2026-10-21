"use client";

// "Play my file": when you've picked a file of this song in Local Cuts this
// visit, play it right here. If Local Cuts remembers a file of it but it isn't
// connected right now (new visit, other device), say so.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { localFileFor, onLocalFiles } from "../../local/store";

export default function MyFile({ trackId }: { trackId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [remembered, setRemembered] = useState(false);
  const [open, setOpen] = useState(false);
  const url = useRef<string | null>(null);

  useEffect(() => {
    const check = () => setFile(localFileFor(trackId));
    check();
    try {
      const saved = JSON.parse(localStorage.getItem("static_cuts_local_cuts") ?? "[]") as { track_id: string | null }[];
      setRemembered(saved.some((s) => s.track_id === trackId));
    } catch { /* fine */ }
    return onLocalFiles(check);
  }, [trackId]);

  useEffect(() => () => { if (url.current) URL.revokeObjectURL(url.current); }, []);

  if (file) {
    if (open && !url.current) url.current = URL.createObjectURL(file);
    return (
      <div style={{ marginTop: 8 }}>
        <button className={`tab ${open ? "active" : ""}`} onClick={() => setOpen(!open)}>{open ? "close my file" : "▶ play my file"}</button>
        {open && url.current && <audio src={url.current} controls autoPlay style={{ display: "block", width: "100%", maxWidth: 420, marginTop: 6 }} />}
      </div>
    );
  }
  if (remembered) {
    return (
      <div className="comment-meta" style={{ marginTop: 6 }}>
        You have a file of this song in <Link href="/local" className="text-link">Local Cuts</Link>, but it isn&apos;t connected on
        this device right now: pick it again there to play it.
      </div>
    );
  }
  return null;
}
