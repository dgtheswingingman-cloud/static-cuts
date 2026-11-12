"use client";

// Share a ready-made picture (cards.ts): the share sheet on phones (so it goes
// straight to an Instagram / TikTok story), a download on computers. The
// picture is drawn ahead of time, because a phone only opens the share sheet
// straight from a tap.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { shareBlob } from "./cards";

export default function CardButton({ make, makeKey, fileName, title, label = "Share card//", className = "tab" }: {
  make: () => Promise<Blob | null>; makeKey: string; fileName: string; title: string; label?: ReactNode; className?: string;
}) {
  const blob = useRef<Promise<Blob | null> | null>(null);
  const makeRef = useRef(make);
  makeRef.current = make;
  const [busy, setBusy] = useState(false);
  useEffect(() => { blob.current = makeRef.current(); }, [makeKey]);
  async function go() {
    setBusy(true);
    const b = await (blob.current ?? (blob.current = makeRef.current()));
    await shareBlob(b, fileName, title);
    setBusy(false);
  }
  return <button className={className} onClick={go} disabled={busy}>{busy ? "Making…" : label}</button>;
}
