"use client";

// Welcome for new accounts, three short steps (each can be skipped):
//   1. pick at least 5 artists to follow (the /start page)
//   2. your profile: name, picture, a line about you
//   3. bring your music in: Spotify (via Exportify) or Apple Music
// Finishing or skipping marks the account as welcomed (profiles.onboarded_at),
// so it's only shown once.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { usePersonalUser } from "../useIsAdmin";
import { useAuth } from "../AuthProvider";
import { finishWelcome } from "../components/OnboardingGate";

function Steps({ step }: { step: number }) {
  const names = ["Your artists", "Your profile", "Your music"];
  return (
    <div style={{ display: "flex", gap: 8, margin: "6px 0 22px", flexWrap: "wrap" }}>
      {names.map((n, i) => (
        <span key={n} className={`feature-tag`} style={{ opacity: i + 1 === step ? 1 : 0.45, borderColor: i + 1 === step ? "var(--bone)" : undefined }}>
          {i + 1}. {n}
        </span>
      ))}
    </div>
  );
}

function Welcome() {
  const { loading } = useAuth();
  const user = usePersonalUser();
  const router = useRouter();
  const params = useSearchParams();
  const step = Math.min(3, Math.max(1, Number(params.get("step")) || 1));
  // Admin preview ("preview welcome" in the admin bar): the same steps, nothing saved.
  const preview = params.get("preview") === "1";
  const pq = preview ? "&preview=1" : "";
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || preview) return;
    supabase.from("profiles").select("display_name, about, avatar_url").eq("id", user.id).maybeSingle().then(({ data }) => {
      setName((data?.display_name as string) ?? "");
      setAbout((data?.about as string) ?? "");
      setAvatar((data?.avatar_url as string) ?? null);
    });
  }, [user]);

  // Step 1 lives on the artist picker; send them there.
  useEffect(() => {
    if ((user || preview) && step === 1) router.replace(`/start?welcome=1${pq}`);
  }, [user, preview, pq, step, router]);

  if (loading) return <div className="wrap"><div className="empty-state">loading…</div></div>;
  if (!user && !preview) return <div className="wrap"><div className="empty-state">Log in to set up your account. <Link href="/login" className="text-link">Log in</Link></div></div>;

  async function uploadAvatar(file: File) {
    if (preview) { setAvatar(URL.createObjectURL(file)); return; }
    if (!user) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) { setError("Please use a PNG, JPEG, WEBP or GIF image."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("That image is too big (5 MB max)."); return; }
    setBusy(true);
    setError(null);
    const path = `${user.id}/avatar.${file.name.split(".").pop()}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (upErr) { setError(upErr.message); setBusy(false); return; }
    const url = `${supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl}?t=${Date.now()}`;
    await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id);
    setAvatar(url);
    setBusy(false);
  }

  async function saveProfile() {
    if (preview) { router.push(`/welcome?step=3${pq}`); return; }
    if (!user) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("profiles")
      .update({ display_name: name.trim() || null, about: about.trim() || null }).eq("id", user.id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    router.push("/welcome?step=3");
  }

  async function finish(to: string) {
    if (preview) { router.push(to === "/" ? "/control" : to); return; }
    if (!user) return;
    setBusy(true);
    await finishWelcome(user.id);
    router.push(to);
  }

  if (step === 2) {
    return (
      <div className="wrap" style={{ maxWidth: 560 }}>
        <h1 className="detail-name page-title">Make it yours</h1>
        {preview && <div className="comments-panel" style={{ marginBottom: 14 }}>Preview of what new accounts see. Nothing here is saved.</div>}
        <Steps step={2} />
        <div className="detail-meta" style={{ marginBottom: 16 }}>How you show up next to your comments, ratings and finds.</div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16 }}>
          {avatar
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={avatar} alt="" width={84} height={84} style={{ borderRadius: 999, objectFit: "cover" }} />
            : <div style={{ width: 84, height: 84, borderRadius: 999, background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--smoke)" }}>SC//</div>}
          <label className="tab" style={{ cursor: "pointer" }}>
            {busy ? "…" : avatar ? "change picture" : "add a picture"}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
          </label>
        </div>
        <div className="section-label">Name</div>
        <input className="search-input" style={{ width: "100%", marginBottom: 12 }} maxLength={40} placeholder="What should people call you?" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="section-label">About you <span className="comment-meta">(optional)</span></div>
        <textarea className="search-input" style={{ width: "100%", minHeight: 70, marginBottom: 12 }} maxLength={200} placeholder="e.g. Opium leaks, Drain Gang deep cuts, always hunting V1s" value={about} onChange={(e) => setAbout(e.target.value)} />
        {error && <div className="comment-meta error-text" style={{ marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="tab active" disabled={busy} onClick={saveProfile}>next</button>
          <Link href={`/welcome?step=3${pq}`} className="text-link comment-meta">skip</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap" style={{ maxWidth: 560 }}>
      <h1 className="detail-name page-title">Bring your music in</h1>
      {preview && <div className="comments-panel" style={{ marginBottom: 14 }}>Preview of what new accounts see. Nothing here is saved.</div>}
      <Steps step={3} />
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        Already have playlists? Bring them in and every song we have gets ticked in your collection, so you can see
        what you&apos;ve got and what you&apos;re missing. Nothing is shared unless you choose to.
      </div>
      <div className="comments-panel" style={{ marginBottom: 12 }}>
        <div className="comment-body"><b>Spotify</b></div>
        <div className="comment-meta" style={{ margin: "4px 0 10px" }}>
          Use <a href="https://exportify.app" target="_blank" rel="noopener noreferrer" className="text-link">Exportify</a> (free):
          log in with Spotify, export your playlists or liked songs, then drop the file in on the next page.
        </div>
        <button className="tab active" disabled={busy} onClick={() => finish("/collection/import")}>import from Spotify</button>
      </div>
      <div className="comments-panel" style={{ marginBottom: 16 }}>
        <div className="comment-body"><b>Apple Music</b></div>
        <div className="comment-meta" style={{ margin: "4px 0 10px" }}>
          In the Music app on a computer: pick a playlist, then File → Library → Export Playlist, and drop the file in on the next page.
        </div>
        <button className="tab" disabled={busy} onClick={() => finish("/collection/import")}>import from Apple Music</button>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="tab" disabled={busy} onClick={() => finish("/")}>I&apos;m done, take me in</button>
        <Link href={`/welcome?step=2${pq}`} className="text-link comment-meta">back</Link>
      </div>
    </div>
  );
}

export default function WelcomePage() {
  return <Suspense fallback={<div className="wrap"><div className="empty-state">loading…</div></div>}><Welcome /></Suspense>;
}
