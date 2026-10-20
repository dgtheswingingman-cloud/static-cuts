"use client";

// Static Cuts Wrapped: your year as full-screen slides. Tap (or press →) to
// go on, ← to go back; every slide can be shared as a story picture.

import { useEffect, useMemo, useState } from "react";
import { shareStory, type Story } from "../components/story";

type Review = {
  year: number; collected: number; unreleased_collected: number; artists: number;
  top_artists: { artist_id: string; artist: string; n: number }[];
  rarest: { track_id: string; title: string; artist: string; holders: number }[];
  by_status: Record<string, number>;
  ratings: number; top_rated: { track_id: string; title: string; artist: string; value: number }[];
  follows: number; approved_suggestions: number; comments: number;
};

type Slide = { kicker: string; big?: string; title: string; lines?: string[]; note?: string };

const n = (x: number) => Number(x).toLocaleString("en-GB");

function slidesFor(r: Review): Slide[] {
  const out: Slide[] = [];
  out.push({ kicker: `your ${r.year}`, title: "Static Cuts Wrapped", note: "Tap to start" });
  out.push({ kicker: "you collected", big: n(r.collected), title: r.collected === 1 ? "song" : "songs",
    lines: [`from ${n(r.artists)} artist${r.artists === 1 ? "" : "s"}`] });
  if (r.unreleased_collected > 0) {
    const pct = r.collected ? Math.round((r.unreleased_collected * 100) / r.collected) : 0;
    out.push({ kicker: "deep in the vault", big: `${pct}%`, title: "never officially out",
      lines: [`${n(r.unreleased_collected)} unreleased, leaked or snippet songs`] });
  }
  if (r.top_artists[0]) {
    out.push({ kicker: "your number one", title: r.top_artists[0].artist, lines: [`${n(r.top_artists[0].n)} songs collected`] });
  }
  if (r.top_artists.length > 1) {
    out.push({ kicker: "your top artists", title: "On repeat", lines: r.top_artists.slice(0, 5).map((a, i) => `${i + 1}. ${a.artist}`) });
  }
  if (r.rarest[0]) {
    const x = r.rarest[0];
    out.push({ kicker: "rarest find", title: x.title, lines: [x.artist, x.holders === 1 ? "only you have it" : `only ${x.holders} collectors have it`] });
  }
  if (r.top_rated[0]) {
    out.push({ kicker: "you rated it highest", title: r.top_rated[0].title, lines: [r.top_rated[0].artist, `${r.top_rated[0].value}/10`] });
  }
  const helped = r.approved_suggestions + r.comments;
  if (helped > 0 || r.follows > 0) {
    out.push({ kicker: "you helped build it", title: "The archive",
      lines: [
        ...(r.approved_suggestions ? [`${n(r.approved_suggestions)} suggestion${r.approved_suggestions === 1 ? "" : "s"} approved`] : []),
        ...(r.comments ? [`${n(r.comments)} comment${r.comments === 1 ? "" : "s"}`] : []),
        ...(r.follows ? [`${n(r.follows)} artist${r.follows === 1 ? "" : "s"} followed`] : []),
        ...(r.ratings ? [`${n(r.ratings)} song${r.ratings === 1 ? "" : "s"} rated`] : []),
      ] });
  }
  out.push({ kicker: `that was ${r.year}`, title: "See you next year",
    lines: [`${n(r.collected)} songs`, ...(r.top_artists[0] ? [`#1 ${r.top_artists[0].artist}`] : []), ...(r.rarest[0] ? [`rarest: ${r.rarest[0].title}`] : [])] });
  return out;
}

export default function Wrapped({ review, onClose }: { review: Review; onClose: () => void }) {
  const slides = useMemo(() => slidesFor(review), [review]);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const s = slides[i];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, slides.length - 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length, onClose]);

  async function share() {
    setBusy(true);
    const story: Story = { kicker: `${review.year} wrapped · ${s.kicker}`, title: s.title, bigNumber: s.big, lines: s.lines };
    await shareStory(story, `static-cuts-wrapped-${review.year}-${i + 1}`);
    setBusy(false);
  }

  return (
    <div className="wrapped" role="dialog" aria-label={`Your ${review.year} Wrapped`}>
      <div className="wrapped-bars">
        {slides.map((_, k) => <span key={k} className={k <= i ? "on" : ""} />)}
      </div>
      <button className="wrapped-close" aria-label="Close" onClick={onClose}>×</button>
      <div className="wrapped-slide" key={i}
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          if (e.clientX - r.left < r.width / 3) setI((x) => Math.max(x - 1, 0));
          else setI((x) => Math.min(x + 1, slides.length - 1));
        }}>
        <div className="wrapped-kicker">{s.kicker}</div>
        {s.big && <div className="wrapped-big">{s.big}</div>}
        <div className="wrapped-title">{s.title}</div>
        {s.lines?.map((l) => <div key={l} className="wrapped-line">{l}</div>)}
        {s.note && <div className="wrapped-note">{s.note}</div>}
      </div>
      <div className="wrapped-foot">
        <button className="tab" disabled={busy} onClick={share}>{busy ? "making…" : "share this slide"}</button>
        <span className="comment-meta">{i + 1} / {slides.length}</span>
      </div>
    </div>
  );
}
