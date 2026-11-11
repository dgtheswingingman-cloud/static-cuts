"use client";

// Export your collection three ways: a private Spotify playlist, a file for
// Apple Music (through a transfer app, since Apple doesn't let sites add
// playlists directly), or a full spreadsheet. Song details only, never audio.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import ExportToSpotify from "../ExportToSpotify";

type Row = { id: string; title: string; album: string | null; release_status: string | null; release_date: string | null; spotify_url: string | null; artist: string };

function csv(rows: (string | null)[][]) {
  return rows.map((r) => r.map((c) => {
    const v = c ?? "";
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(",")).join("\n");
}

function save(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function ExportCard({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("track_ownership").select("tracks(id, title, album, release_status, release_date, spotify_url, artists!artist_id(name))")
      .eq("user_id", userId).order("collected_at", { ascending: false }).limit(5000)
      .then(({ data }) => {
        type T = { id: string; title: string; album: string | null; release_status: string | null; release_date: string | null; spotify_url: string | null; artists: { name: string } | { name: string }[] | null };
        const out: Row[] = [];
        for (const r of (data ?? []) as unknown as { tracks: T | T[] | null }[]) {
          const t = Array.isArray(r.tracks) ? r.tracks[0] : r.tracks;
          if (!t) continue;
          const a = Array.isArray(t.artists) ? t.artists[0] : t.artists;
          out.push({ id: t.id, title: t.title, album: t.album, release_status: t.release_status, release_date: t.release_date, spotify_url: t.spotify_url, artist: a?.name ?? "" });
        }
        setRows(out);
      });
  }, [userId]);

  const day = new Date().toISOString().slice(0, 10);
  const apple = () => {
    if (!rows?.length) return;
    // Title / Artist / Album: what transfer apps like TuneMyMusic and SongShift read.
    save(`static-cuts-collection-apple-music-${day}.csv`, csv([["Title", "Artist", "Album"], ...rows.map((r) => [r.title, r.artist, r.album])]));
    setNote("Saved. Open it in a transfer app such as TuneMyMusic (“upload file”) and pick Apple Music. Only released songs will match.");
  };
  const file = () => {
    if (!rows?.length) return;
    save(`static-cuts-collection-${day}.csv`, csv([
      ["Title", "Artist", "Album", "Status", "Release date", "Spotify", "Static-Cuts"],
      ...rows.map((r) => [r.title, r.artist, r.album, r.release_status, r.release_date, r.spotify_url, `https://static-cuts.com/song/${r.id}`]),
    ]));
    setNote("Saved: every song you've collected, with its status and links.");
  };

  return (
    <div className="lb-card lb-import lb-export" id="export">
      <span className="sp-version-text">
        <strong>Export your collection</strong>
        <span>{rows === null ? "loading…" : rows.length === 0 ? "Nothing collected yet." : `${rows.length.toLocaleString("en-GB")} songs. Take them to Spotify, Apple Music or a spreadsheet.`}</span>
      </span>
      {rows && rows.length > 0 && (
        <span className="lb-import-pills lb-export-btns">
          <ExportToSpotify name="My Static-Cuts collection" back="/library#export" className="lb-export-btn" label="Spotify"
            description="Everything I've collected on Static-Cuts// that's on Spotify." urls={rows.map((r) => r.spotify_url)} />
          <button className="lb-export-btn" onClick={apple}>Apple Music</button>
          <button className="lb-export-btn" onClick={file}>File / CSV</button>
        </span>
      )}
      {note && <span className="comment-meta lb-export-note">{note}</span>}
    </div>
  );
}
