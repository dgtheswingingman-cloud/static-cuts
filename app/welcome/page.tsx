"use client";

// Welcome for new accounts, three short steps (each can be skipped):
//   1. pick at least 5 artists to follow (the /start page)
//   2. your profile: name, picture, a line about you
//   3. bring your music in: Spotify (via Exportify) or Apple Music
// Finishing or skipping marks the account as welcomed (profiles.onboarded_at),
// so it's only shown once.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { usePersonalUser } from "../useIsAdmin";
import { useAuth } from "../AuthProvider";
import { finishWelcome } from "../components/OnboardingGate";

function Steps({ step, skip }: { step: number; skip?: string }) {
  return (
    <div className="wl-steps">
      <span>Step {step} of 3</span>
      {skip && <Link href={skip} className="wl-skip">Skip</Link>}
      <span className="wl-progress"><span style={{ width: `${(step / 3) * 100}%` }} /></span>
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
      <div className="wrap wl-page wl-narrow">
        <h1 className="ls-title wl-title">MAKE IT YOURS<span>//</span></h1>
        {preview && <div className="comments-panel" style={{ marginBottom: 14 }}>Preview of what new accounts see. Nothing here is saved.</div>}
        <Steps step={2} skip={`/welcome?step=3${pq}`} />
        <p className="wl-lead">How you show up next to your comments, lists and finds.</p>
        <label className="wl-avatar" aria-label={avatar ? "Change picture" : "Add a picture"}>
          {avatar
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={avatar} alt="" />
            : <span className="wl-avatar-blank" aria-hidden="true"><svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></svg></span>}
          <span className="wl-cam" aria-hidden="true">{busy ? "…" : <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
        </label>
        <label className="wl-label">Display name
          <input className="sb-text" maxLength={40} placeholder="What should people call you?" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="wl-label">Tagline <small>(optional)</small>
          <textarea className="sb-text sb-area wl-tagline" maxLength={80} placeholder="e.g. Opium leaks, Drain Gang deep cuts, always hunting V1s" value={about} onChange={(e) => setAbout(e.target.value)} />
          <small className="wl-count">{about.length} / 80</small>
        </label>
        {error && <div className="sb-error">{error}</div>}
        <div className="wl-buttons">
          <Link href={`/welcome?step=3${pq}`} className="st-btn wl-skip-btn">Skip</Link>
          <button className="sb-submit wl-next" disabled={busy} onClick={saveProfile}>Next//</button>
        </div>
      </div>
    );
  }

  const card = (key: string, icon: ReactNode, title: string, text: string) => (
    <button key={key} className="wl-service" disabled={busy} onClick={() => finish("/collection/import")}>
      <span className="wl-service-icon">{icon}</span>
      <span className="wl-service-text"><strong>{title}</strong><span>{text}</span></span>
      <span className="hf-chev" aria-hidden="true">›</span>
    </button>
  );

  return (
    <div className="wrap wl-page wl-narrow">
      <h1 className="ls-title wl-title">BRING YOUR MUSIC IN<span>//</span></h1>
      {preview && <div className="comments-panel" style={{ marginBottom: 14 }}>Preview of what new accounts see. Nothing here is saved.</div>}
      <Steps step={3} />
      <p className="wl-lead">Already have playlists? Bring them in and every song we have gets ticked in your collection, so you can see what you&apos;ve got and what you&apos;re missing. Nothing is shared unless you choose to.</p>
      {card("spotify", <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#1DB954" /><path d="M6.5 9.3c3.6-1.1 7.8-.8 11 1M7.2 12.3c3-.9 6.4-.6 9 .9M7.8 15.1c2.4-.6 5-.4 7 .8" stroke="#070707" strokeWidth="1.6" strokeLinecap="round" fill="none" /></svg>,
        "Spotify", "Your Liked Songs and playlists, using Exportify (free) to make the file.")}
      {card("apple", <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#FA2D48" /><path d="M10 17.5V8l8-1.6v9.4" stroke="#fff" strokeWidth="1.6" fill="none" /><circle cx="8.6" cy="17.5" r="1.8" fill="#fff" /><circle cx="16.6" cy="15.8" r="1.8" fill="#fff" /></svg>,
        "Apple Music", "In the Music app on a computer: File → Library → Export Playlist, then drop the file in.")}
      {card("file", <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></svg>,
        "File / CSV", "A list of songs from anywhere else (CSV or text).")}
      <div className="wl-buttons">
        <Link href={`/welcome?step=2${pq}`} className="st-btn wl-skip-btn">Back</Link>
        <button className="sb-submit wl-next" disabled={busy} onClick={() => finish("/")}>Finish//</button>
      </div>
    </div>
  );
}

export default function WelcomePage() {
  return <Suspense fallback={<div className="wrap"><div className="empty-state">loading…</div></div>}><Welcome /></Suspense>;
}
