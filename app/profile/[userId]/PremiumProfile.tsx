"use client";

// Premium profiles: a banner (GIF allowed), a profile colour, a GIF avatar
// and a showcase of up to 6 pinned songs. The database refuses these without
// premium; if premium ends they're kept but hidden until it's back.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export type ShowSong = { id: string; title: string; artist_id: string; artist: string; status: string; cover: string | null };
export type ProfileStyle = { premium: boolean; accent?: string | null; banner_url?: string | null; showcase?: ShowSong[] };

export function useProfileStyle(userId: string) {
  const [style, setStyle] = useState<ProfileStyle | null>(null);
  const load = () => supabase.rpc("rpc_profile_style", { p_user: userId }).then(({ data }) => setStyle((data as ProfileStyle) ?? { premium: false }));
  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  return { style, reload: load };
}

export const SWATCHES = ["#8B7CF6", "#FF3355", "#2BD67B", "#22D3EE", "#FFB020", "#FF6AD5", "#EDEDED", "#9AA4B2"];

export function Showcase({ songs, accent }: { songs: ShowSong[]; accent?: string | null }) {
  if (!songs.length) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="section-label" style={{ color: accent ?? undefined }}>Showcase</div>
      <div className="pf-showcase">
        {songs.map((s) => (
          <Link key={s.id} href={`/song/${s.id}`} className="pf-show-card" style={{ borderColor: accent ?? undefined }}>
            {s.cover
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={s.cover} alt="" loading="lazy" />
              : <div className="era-card-blank" />}
            <span className="pf-show-title">{s.title}</span>
            <span className="pf-show-meta">{s.artist} · {s.status}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function PremiumTeaser() {
  return (
    <div className="pf-teaser">
      <div className="section-label" style={{ marginTop: 0 }}>Premium profile</div>
      <div className="comment-meta" style={{ lineHeight: 1.6 }}>
        ◆ supporter badge next to your name · your own profile colour · a banner (GIFs too) · a GIF avatar · a showcase of
        6 pinned songs. Plus Local Cuts. £3 a month or £30 a year, coming soon.
      </div>
    </div>
  );
}

type Found = { id: string; title: string; artist: string; status: string };

// Owner of the profile, with premium: change the look.
export function CustomiseProfile({ userId, style, onSaved }: { userId: string; style: ProfileStyle; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [accent, setAccent] = useState(style.accent ?? "");
  const [show, setShow] = useState<Found[]>((style.showcase ?? []).map((s) => ({ id: s.id, title: s.title, artist: s.artist, status: s.status })));
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const words = q.trim();
    if (words.length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("rpc_search_songs", {
        p_q: words, p_versions: true, p_sort: "best", p_offset: 0,
      });
      setFound((((data as { items?: Found[] } | null)?.items) ?? []).slice(0, 8));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function save(fields: Record<string, unknown>, done = "Saved.") {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.from("profiles").update(fields).eq("id", userId);
    setBusy(false);
    if (error) { setMsg(error.message); return false; }
    setMsg(done);
    onSaved();
    return true;
  }

  async function uploadBanner(file: File) {
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) { setMsg("PNG, JPEG, WEBP or GIF."); return; }
    if (file.size > 8 * 1024 * 1024) { setMsg("8MB max."); return; }
    setBusy(true);
    const path = `${userId}/banner.${file.name.split(".").pop()}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    const url = `${supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl}?t=${Date.now()}`;
    await save({ banner_url: url }, "Banner saved.");
  }

  if (!open) return <button className="tab" onClick={() => setOpen(true)}>◆ customise profile</button>;

  return (
    <div className="pf-teaser" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="section-label" style={{ marginTop: 0 }}>◆ Customise profile</div>
        <button className="tab" onClick={() => setOpen(false)}>close</button>
      </div>

      <div className="comment-meta" style={{ marginBottom: 6 }}>Colour</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        {SWATCHES.map((c) => (
          <button key={c} aria-label={c} onClick={() => { setAccent(c); save({ accent: c }); }}
            style={{ width: 28, height: 28, background: c, border: accent === c ? "2px solid var(--bone)" : "1px solid var(--hair)", cursor: "pointer" }} />
        ))}
        <input className="search-input" style={{ width: 110 }} placeholder="#8B7CF6" value={accent} onChange={(e) => setAccent(e.target.value)} />
        <button className="tab" disabled={busy || !/^#[0-9a-f]{6}$/i.test(accent)} onClick={() => save({ accent })}>set</button>
        {style.accent && <button className="tab" disabled={busy} onClick={() => { setAccent(""); save({ accent: null }); }}>default</button>}
      </div>

      <div className="comment-meta" style={{ marginBottom: 6 }}>Banner (wide picture, GIFs work)</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <input type="file" accept="image/*" id="bannerInput" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) uploadBanner(e.target.files[0]); }} />
        <label htmlFor="bannerInput" className="tab" style={{ cursor: "pointer" }}>{style.banner_url ? "change banner" : "add banner"}</label>
        {style.banner_url && <button className="tab" disabled={busy} onClick={() => save({ banner_url: null })}>remove</button>}
      </div>

      <div className="comment-meta" style={{ marginBottom: 6 }}>Showcase: up to 6 songs pinned to the top of your profile</div>
      {show.map((s, i) => (
        <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
          <span className="comment-body">{i + 1}. {s.title} <span className="comment-meta">· {s.artist}</span></span>
          <button className="rating-clear" onClick={() => setShow(show.filter((x) => x.id !== s.id))}>remove</button>
        </div>
      ))}
      {show.length < 6 && (
        <>
          <input className="search-input" style={{ width: "100%", marginTop: 4 }} placeholder="Find a song to pin…" value={q} onChange={(e) => setQ(e.target.value)} />
          {found.filter((f) => !show.some((s) => s.id === f.id)).map((f) => (
            <button key={f.id} className="pf-pick" onClick={() => { setShow([...show, f]); setQ(""); }}>
              {f.title} <span className="comment-meta">· {f.artist} · {f.status}</span>
            </button>
          ))}
        </>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <button className="tab active" disabled={busy} onClick={() => save({ showcase: show.map((s) => s.id) }, "Showcase saved.")}>save showcase</button>
        {msg && <span className="comment-meta">{msg}</span>}
      </div>
    </div>
  );
}
