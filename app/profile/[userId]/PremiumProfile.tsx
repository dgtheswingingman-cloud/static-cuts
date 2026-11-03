"use client";

// Premium profiles: a banner (GIF allowed), a profile colour, a GIF avatar
// and a showcase of up to 6 pinned songs. The database refuses these without
// premium; if premium ends they're kept but hidden until it's back.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { artistTag, forgetBadges } from "../../components/Supporter";

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

export function Showcase({ songs, accent, bare = false }: { songs: ShowSong[]; accent?: string | null; bare?: boolean }) {
  if (!songs.length) return null;
  return (
    <div style={{ marginBottom: bare ? 0 : 18 }}>
      {!bare && <div className="section-label" style={{ color: accent ?? undefined }}>Showcase</div>}
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
export type EditableProfile = { display_name: string | null; about: string | null; avatar_url: string | null; fan_artists?: string[] };
type Followed = { artist_id: string; name: string; tag: string | null };

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function Row({ label, premium, locked, children }: { label: string; premium?: boolean; locked?: boolean; children: ReactNode }) {
  return (
    <div className={`pf-edit-row${locked ? " locked" : ""}`}>
      <div className="pf-edit-label">
        {label}
        {premium && <span className="pf-prem-tag">◆ premium</span>}
      </div>
      <div className="pf-edit-body">{children}</div>
    </div>
  );
}

// Everything about your profile in one place. Premium parts are labelled;
// without premium they show but can't be changed.
export function EditProfile({ userId, profile, style, premium, followed, onClose, onProfile, onStyle }: {
  userId: string; profile: EditableProfile; style: ProfileStyle; premium: boolean; followed: Followed[];
  onClose: () => void; onProfile: (p: Partial<EditableProfile>) => void; onStyle: () => void;
}) {
  const [name, setName] = useState(profile.display_name ?? "");
  const [about, setAbout] = useState(profile.about ?? "");
  const [accent, setAccent] = useState(style.accent ?? "");
  const [show, setShow] = useState<Found[]>((style.showcase ?? []).map((s) => ({ id: s.id, title: s.title, artist: s.artist, status: s.status })));
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const locked = !premium;
  const [fans, setFans] = useState<string[]>(profile.fan_artists ?? []);
  const maxFans = premium ? 3 : 1;
  const tagOf = (id: string) => { const f = followed.find((x) => x.artist_id === id); return f ? (f.tag || artistTag(f.name)) : "?"; };
  const nameOf = (id: string) => followed.find((x) => x.artist_id === id)?.name ?? id;
  async function saveFans(next: string[]) {
    setFans(next);
    if (await save({ fan_artists: next }, "Fan badges saved.")) { onProfile({ fan_artists: next }); forgetBadges(userId); }
  }

  useEffect(() => {
    const words = q.trim();
    if (words.length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("rpc_search_songs", { p_q: words, p_versions: true, p_sort: "best", p_offset: 0 });
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
    return true;
  }

  async function upload(file: File, kind: "avatar" | "banner") {
    if (!IMAGE_TYPES.includes(file.type)) { setMsg("PNG, JPEG, WEBP or GIF."); return null; }
    if (file.size > (kind === "avatar" ? 5 : 8) * 1024 * 1024) { setMsg(kind === "avatar" ? "5MB max." : "8MB max."); return null; }
    if (kind === "avatar" && file.type === "image/gif" && !premium) { setMsg("GIF avatars are a premium perk."); return null; }
    setBusy(true);
    const path = `${userId}/${kind}.${file.name.split(".").pop()}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    setBusy(false);
    if (error) { setMsg(error.message); return null; }
    return `${supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl}?t=${Date.now()}`;
  }

  return (
    <div className="pf-edit">
      <div className="pf-edit-head">
        <span>Edit profile</span>
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {msg && <span className="comment-meta" style={{ textTransform: "none", letterSpacing: 0 }}>{msg}</span>}
          <button className="tab" onClick={onClose}>done</button>
        </span>
      </div>

      <Row label="Name">
        <input className="search-input" style={{ width: "100%", maxWidth: 320 }} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </Row>
      <Row label="Bio">
        <textarea className="comment-textarea" style={{ marginBottom: 8 }} value={about} maxLength={500} placeholder="A short bio, what you're into, whatever you want…" onChange={(e) => setAbout(e.target.value)} />
        <button className="tab active" disabled={busy || !name.trim()} onClick={async () => {
          if (await save({ display_name: name.trim(), about: about.trim() }, "Name and bio saved.")) onProfile({ display_name: name.trim(), about: about.trim() });
        }}>save name &amp; bio</button>
      </Row>

      <Row label="Picture">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input type="file" accept="image/*" id="pfAvatarInput" style={{ display: "none" }} onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const url = await upload(f, "avatar");
            if (url && await save({ avatar_url: url }, "Picture saved.")) onProfile({ avatar_url: url });
          }} />
          <label htmlFor="pfAvatarInput" className="tab" style={{ cursor: "pointer" }}>{profile.avatar_url ? "change picture" : "add picture"}</label>
          <span className="comment-meta">PNG or JPEG. Animated GIFs <span className="pf-prem-tag">◆ premium</span></span>
        </div>
      </Row>

      <Row label="Fan badges">
        <div className="comment-meta" style={{ marginBottom: 8 }}>
          Show which artists you ride for: their tag sits next to your name everywhere and links to them. 1 badge, or up to 3 with <span className="pf-prem-tag">◆ premium</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {fans.map((id) => (
            <button key={id} className="fan-tag big" title={`Remove ${nameOf(id)}`} onClick={() => saveFans(fans.filter((x) => x !== id))}>
              {tagOf(id)} <span style={{ opacity: 0.6 }}>×</span>
            </button>
          ))}
          {!fans.length && <span className="comment-meta">None yet.</span>}
        </div>
        {followed.length === 0
          ? <div className="comment-meta">Follow some artists first.</div>
          : (
            <select className="search-input" style={{ maxWidth: 320 }} value="" disabled={busy || fans.length >= maxFans}
              onChange={(e) => { const id = e.target.value; if (id && !fans.includes(id)) saveFans([...fans, id]); }}>
              <option value="">{fans.length >= maxFans ? (premium ? "3 badges max" : "Premium for more badges") : "Add an artist you follow…"}</option>
              {followed.filter((f) => !fans.includes(f.artist_id)).sort((a, b) => a.name.localeCompare(b.name)).map((f) => (
                <option key={f.artist_id} value={f.artist_id}>{f.name} ({f.tag || artistTag(f.name)})</option>
              ))}
            </select>
          )}
      </Row>

      <Row label="Colour" premium locked={locked}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {SWATCHES.map((c) => (
            <button key={c} aria-label={c} disabled={locked} onClick={async () => { setAccent(c); if (await save({ accent: c }, "Colour saved.")) onStyle(); }}
              style={{ width: 28, height: 28, background: c, border: accent === c ? "2px solid var(--bone)" : "1px solid var(--hair)", cursor: locked ? "not-allowed" : "pointer" }} />
          ))}
          <input className="search-input" style={{ width: 110 }} placeholder="#8B7CF6" value={accent} disabled={locked} onChange={(e) => setAccent(e.target.value)} />
          <button className="tab" disabled={locked || busy || !/^#[0-9a-f]{6}$/i.test(accent)} onClick={async () => { if (await save({ accent }, "Colour saved.")) onStyle(); }}>set</button>
          {style.accent && !locked && <button className="tab" disabled={busy} onClick={async () => { setAccent(""); if (await save({ accent: null }, "Colour reset.")) onStyle(); }}>default</button>}
        </div>
      </Row>

      <Row label="Banner" premium locked={locked}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="file" accept="image/*" id="pfBannerInput" style={{ display: "none" }} disabled={locked} onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const url = await upload(f, "banner");
            if (url && await save({ banner_url: url }, "Banner saved.")) onStyle();
          }} />
          <label htmlFor={locked ? undefined : "pfBannerInput"} className="tab" style={{ cursor: locked ? "not-allowed" : "pointer" }}>{style.banner_url ? "change banner" : "add banner"}</label>
          {style.banner_url && !locked && <button className="tab" disabled={busy} onClick={async () => { if (await save({ banner_url: null }, "Banner removed.")) onStyle(); }}>remove</button>}
          <span className="comment-meta">A wide picture across the top. GIFs work.</span>
        </div>
      </Row>

      <Row label="Showcase" premium locked={locked}>
        <div className="comment-meta" style={{ marginBottom: 6 }}>Up to 6 songs pinned to the top of your profile.</div>
        {show.map((s, i) => (
          <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
            <span className="comment-body">{i + 1}. {s.title} <span className="comment-meta">· {s.artist}</span></span>
            {!locked && <button className="rating-clear" onClick={() => setShow(show.filter((x) => x.id !== s.id))}>remove</button>}
          </div>
        ))}
        {show.length < 6 && (
          <>
            <input className="search-input" style={{ width: "100%" }} placeholder="Find a song to pin…" value={q} disabled={locked} onChange={(e) => setQ(e.target.value)} />
            {found.filter((f) => !show.some((s) => s.id === f.id)).map((f) => (
              <button key={f.id} className="pf-pick" onClick={() => { setShow([...show, f]); setQ(""); }}>
                {f.title} <span className="comment-meta">· {f.artist} · {f.status}</span>
              </button>
            ))}
          </>
        )}
        <button className="tab active" style={{ marginTop: 8 }} disabled={locked || busy} onClick={async () => { if (await save({ showcase: show.map((s) => s.id) }, "Showcase saved.")) onStyle(); }}>save showcase</button>
      </Row>

      {locked && (
        <div className="pf-edit-foot">
          <span className="pf-prem-tag">◆ premium</span> also gets you the supporter badge and Local Cuts. £3 a month or £30 a year, coming soon.
        </div>
      )}
    </div>
  );
}
