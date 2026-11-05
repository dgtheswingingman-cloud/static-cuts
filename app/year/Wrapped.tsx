"use client";
import "../styles/wrapped.css";

// Your year as full-screen story slides: intro with your top artists, your
// rarest finds, your biggest find, your numbers and an outro. Each slide is
// the actual share picture, so what you see is what you share. Tap (or press
// →) to go on, ← to go back.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { shareBlob, yearBiggest, yearFinds, yearIntro, yearNumbers, yearOutro, type YearData } from "../components/cards";

type Review = {
  year: number; collected: number; unreleased_collected: number; artists: number;
  top_artists: { artist_id: string; artist: string; n: number }[];
  rarest: { track_id: string; title: string; artist: string; holders: number }[];
  by_status: Record<string, number>;
  ratings: number; top_rated: { track_id: string; title: string; artist: string; value: number }[];
  follows: number; approved_suggestions: number; comments: number;
};

const n = (x: number) => Number(x).toLocaleString("en-GB");

export default function Wrapped({ review, userId, onClose }: { review: Review; userId: string; onClose: () => void }) {
  const [slides, setSlides] = useState<{ name: string; url: string; blob: Blob }[] | null>(null);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);

  // Gather the pictures and draw every slide.
  useEffect(() => {
    let gone = false;
    const made: string[] = [];
    (async () => {
      const artistIds = review.top_artists.map((a) => a.artist_id);
      const trackIds = review.rarest.map((r) => r.track_id);
      const [{ data: me }, { data: style }, { data: arts }, { data: tracks }, { count: lists }] = await Promise.all([
        supabase.from("profiles").select("display_name, avatar_url").eq("id", userId).maybeSingle(),
        supabase.rpc("rpc_profile_style", { p_user: userId }),
        artistIds.length ? supabase.from("artists").select("id, image_url").in("id", artistIds) : Promise.resolve({ data: [] }),
        trackIds.length ? supabase.from("tracks").select("id, cover_url, release_status, release_date, leak_date").in("id", trackIds) : Promise.resolve({ data: [] }),
        supabase.from("song_lists").select("id", { count: "exact", head: true }).eq("owner_id", userId)
          .gte("created_at", `${review.year}-01-01`).lt("created_at", `${review.year + 1}-01-01`),
      ]);
      const img = new Map(((arts ?? []) as { id: string; image_url: string | null }[]).map((a) => [a.id, a.image_url]));
      const tr = new Map(((tracks ?? []) as { id: string; cover_url: string | null; release_status: string | null; release_date: string | null; leak_date: string | null }[]).map((t) => [t.id, t]));
      const st = style as { premium?: boolean; accent?: string | null } | null;
      const p = me as { display_name: string | null; avatar_url: string | null } | null;
      const d: YearData = {
        year: review.year, name: p?.display_name ?? "You", avatar: p?.avatar_url ?? null,
        accent: st?.premium ? st.accent ?? null : null, url: "static-cuts.com",
        topArtists: review.top_artists.map((a) => ({ name: a.artist, image: img.get(a.artist_id) ?? null, n: a.n })),
        finds: review.rarest.map((r) => {
          const t = tr.get(r.track_id);
          return { title: r.title, artist: r.artist, status: t?.release_status ?? null, cover: t?.cover_url ?? null,
            year: (t?.release_date ?? t?.leak_date ?? "").slice(0, 4) || null, holders: r.holders };
        }),
        numbers: [
          ["Collected", n(review.collected), `songs from ${n(review.artists)} artist${review.artists === 1 ? "" : "s"}`],
          ...(review.unreleased_collected ? [["Never officially out", n(review.unreleased_collected), "leaks, snippets and unreleased"] as [string, string, string]] : []),
          ["Contributions", n(review.approved_suggestions), "suggestions approved"],
          ["Lists made", n(lists ?? 0), "playlists, collections and lists"],
        ],
      };
      const plan: [string, () => Promise<Blob | null>][] = [
        ["intro", () => yearIntro(d)],
        ...(d.finds.length ? [["finds", () => yearFinds(d)] as [string, () => Promise<Blob | null>], ["biggest", () => yearBiggest(d)] as [string, () => Promise<Blob | null>]] : []),
        ["numbers", () => yearNumbers(d)],
        ["outro", () => yearOutro(d)],
      ];
      const out: { name: string; url: string; blob: Blob }[] = [];
      for (const [name, draw] of plan) {
        const blob = await draw();
        if (gone) return;
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        made.push(url);
        out.push({ name, url, blob });
        setSlides([...out]);
      }
    })();
    return () => { gone = true; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [review, userId]);

  const total = slides?.length ?? 0;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, Math.max(0, total - 1)));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, onClose]);

  const s = slides?.[i];
  async function share() {
    if (!s) return;
    setBusy(true);
    await shareBlob(s.blob, `static-cuts-${review.year}-${s.name}`, `My ${review.year} on Static Cuts//`);
    setBusy(false);
  }

  return (
    <div className="wrapped" role="dialog" aria-label={`Your ${review.year}`}>
      <div className="wrapped-bars">
        {(slides ?? [null]).map((_, k) => <span key={k} className={k <= i ? "on" : ""} />)}
      </div>
      <button className="wrapped-close" aria-label="Close" onClick={onClose}>×</button>
      <div className="wrapped-slide wrapped-pic"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          if (e.clientX - r.left < r.width / 3) setI((x) => Math.max(x - 1, 0));
          else setI((x) => Math.min(x + 1, Math.max(0, total - 1)));
        }}>
        {s
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={s.url} alt={`Your ${review.year}: ${s.name}`} />
          : <div className="wrapped-note">Making your year…</div>}
      </div>
      <div className="wrapped-foot">
        <button className="tab" disabled={busy || !s} onClick={share}>{busy ? "…" : "Share this slide//"}</button>
        <span className="comment-meta">{total ? `${i + 1} / ${total}` : ""}</span>
      </div>
    </div>
  );
}
