"use client";

// "story": makes a phone-sized picture for Instagram / TikTok stories.

import { useState } from "react";
import { shareStory, type Story } from "./story";

export default function StoryButton({ story, fileName, label = "story" }: { story: () => Story | Promise<Story>; fileName: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button className="tab" disabled={busy} title="A picture sized for Instagram, TikTok and Snapchat stories"
      onClick={async () => { setBusy(true); try { await shareStory(await story(), fileName); } finally { setBusy(false); } }}>
      {busy ? "making…" : label}
    </button>
  );
}
