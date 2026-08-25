"use client";

import { useRouter } from "next/navigation";

export default function LegalPage() {
  const router = useRouter();

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← back to archive</button>
      <h1 className="detail-name" style={{ fontSize: "2.2rem" }}>Privacy &amp; Terms</h1>
      <div className="detail-meta" style={{ marginBottom: 24 }}>
        Last updated {new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}.
        Static Cuts// is a small, non-commercial, community-run project — this is written plainly on
        purpose, not as a substitute for legal advice if that ever changes.
      </div>

      <section style={{ marginBottom: 32 }}>
        <div className="section-label">Privacy Policy</div>

        <h2 style={{ fontFamily: "var(--font-anton)", fontSize: "1.2rem", marginTop: 16, marginBottom: 8 }}>What we collect</h2>
        <p className="detail-meta" style={{ marginBottom: 8 }}>
          An account (email and password, or a Spotify login), a display name, and anything you
          choose to add — an avatar, an about section. Your activity on the site: ratings you give
          tracks, comments you post, which tracks you&apos;ve marked collected, which artists you
          follow or pin, and any submissions (new tracks, corrections, flags) you make.
        </p>

        <h2 style={{ fontFamily: "var(--font-anton)", fontSize: "1.2rem", marginTop: 16, marginBottom: 8 }}>What&apos;s public vs. private</h2>
        <p className="detail-meta" style={{ marginBottom: 8 }}>
          Comments and submissions are public by nature — that&apos;s how the archive gets built.
          Your profile has individual toggles (off by default) for showing your completion
          percentage, collected tracks, ratings, and followed artists to other people. Your email
          and password are never shown to anyone, including other admins.
        </p>

        <h2 style={{ fontFamily: "var(--font-anton)", fontSize: "1.2rem", marginTop: 16, marginBottom: 8 }}>Third parties involved</h2>
        <p className="detail-meta" style={{ marginBottom: 8 }}>
          The site runs on Supabase (database, accounts, file storage) and is hosted on Vercel. If
          you log in with Spotify, Spotify handles that authentication directly — we only receive
          what&apos;s needed to identify your account. Search-assist tooling used behind the scenes
          (for finding official links) doesn&apos;t touch your personal data at all.
        </p>

        <h2 style={{ fontFamily: "var(--font-anton)", fontSize: "1.2rem", marginTop: 16, marginBottom: 8 }}>Your data, your choice</h2>
        <p className="detail-meta" style={{ marginBottom: 8 }}>
          You can change or delete anything in your profile at any time. If you want your account
          removed entirely, reach out and it'll be handled directly — this is a small enough project
          that there's no automated self-serve deletion flow yet, just a real person on the other end.
        </p>
      </section>

      <section>
        <div className="section-label">Terms of Service</div>

        <h2 style={{ fontFamily: "var(--font-anton)", fontSize: "1.2rem", marginTop: 16, marginBottom: 8 }}>What this is</h2>
        <p className="detail-meta" style={{ marginBottom: 8 }}>
          A community-maintained discography archive — tracking metadata (titles, dates, producers,
          links to where a track can legitimately be found) for official and unreleased material
          alike, without popularity bias. <b style={{ color: "var(--bone)" }}>This site does not
          host, store, or distribute audio files.</b> Every link points to a real external platform
          (Spotify, and similar) — we track information about music, not the music itself.
        </p>

        <h2 style={{ fontFamily: "var(--font-anton)", fontSize: "1.2rem", marginTop: 16, marginBottom: 8 }}>Contributing</h2>
        <p className="detail-meta" style={{ marginBottom: 8 }}>
          Submissions go through review before anything you contribute becomes visible in the
          archive. Be accurate, be respectful in comments, and don&apos;t submit anything you know
          to be false. Repeated bad-faith submissions or abusive behavior toward other users can
          result in your account being restricted or removed.
        </p>

        <h2 style={{ fontFamily: "var(--font-anton)", fontSize: "1.2rem", marginTop: 16, marginBottom: 8 }}>No guarantees</h2>
        <p className="detail-meta" style={{ marginBottom: 8 }}>
          This is a hobby project, maintained by volunteers, provided as-is. Things may occasionally
          break, change, or move — there&apos;s no formal uptime or support commitment behind it.
        </p>

        <h2 style={{ fontFamily: "var(--font-anton)", fontSize: "1.2rem", marginTop: 16, marginBottom: 8 }}>Changes</h2>
        <p className="detail-meta" style={{ marginBottom: 8 }}>
          These terms may be updated as the site grows. Meaningful changes will be reflected in the
          "last updated" date at the top of this page.
        </p>
      </section>
    </div>
  );
}
