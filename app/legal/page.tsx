"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function LegalPage() {
  const router = useRouter();

  return (
    <div className="wrap">
      <button className="back-btn" onClick={() => router.push("/")}>← home</button>
      <h1 className="detail-name page-title">Privacy &amp; Terms</h1>
      <div className="detail-meta" style={{ marginBottom: 24 }}>
        Last updated 18 October 2026.
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
          Your profile has individual toggles for showing your completion percentage, collected tracks,
          ratings, followed artists and contributions to other people. Your email and password are never
          shown to anyone, including other admins.
        </p>
        <p className="detail-meta" style={{ marginBottom: 8 }}>
          Lists you make are public unless you make them private. Votes (real-or-fake, link votes) are counted
          publicly, but who voted which way isn&apos;t shown. Ratings work the same way. Reports on comments
          are only seen by moderators. Notifications and &ldquo;remind me&rdquo; are private to you, and you can turn the
          daily summary off in settings.
        </p>

        <h2 style={{ fontFamily: "var(--font-anton)", fontSize: "1.2rem", marginTop: 16, marginBottom: 8 }}>Third parties involved</h2>
        <p className="detail-meta" style={{ marginBottom: 8 }}>
          The site runs on Supabase (database, accounts, file storage) and is hosted on Vercel. If
          you log in with Spotify, Spotify handles that authentication directly — we only receive
          what&apos;s needed to identify your account. Search-assist tooling used behind the scenes
          (for finding official links) doesn&apos;t touch your personal data at all.
        </p>
        <p className="detail-meta" style={{ marginBottom: 8 }}>
          Some song information (titles, release dates, albums and links) comes from Spotify, Genius and Last.fm,
          credited on each song it came from. If you connect ChatGPT to your account to help keep artists up to
          date, it can read the catalogue and your followed artists and send finds for review; it can&apos;t change
          the archive or see your email. You can disconnect it at any time.
        </p>
        <p className="detail-meta" style={{ marginBottom: 8 }}>
          Some songs come from community spreadsheets, imported with their makers&apos; permission and credited on
          each song and on the <a href="/sources" style={{ color: "var(--bone)" }}>sources page</a>. Artwork and producer
          credits come from Spotify and Genius. Exporting to a Spotify playlist signs in to Spotify in your browser
          only: we don&apos;t store that sign-in.
        </p>

        <h2 style={{ fontFamily: "var(--font-anton)", fontSize: "1.2rem", marginTop: 16, marginBottom: 8 }}>Your data, your choice</h2>
        <p className="detail-meta" style={{ marginBottom: 8 }}>
          You can change or delete anything in your profile at any time. In Settings, under &ldquo;Your data&rdquo;,
          you can download everything you&apos;ve put in as one file, or delete your account. Deleting removes your
          follows, collection, ratings, lists, votes and settings; approved suggestions stay in the archive without
          your name, and your comments are replaced with &ldquo;[deleted]&rdquo;.
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

        <h2 id="takedowns" style={{ fontFamily: "var(--font-anton)", fontSize: "1.2rem", marginTop: 16, marginBottom: 8 }}>Takedowns</h2>
        <p className="detail-meta" style={{ marginBottom: 8 }}>
          Static Cuts// doesn&apos;t host audio, but we respect artists and rights holders. If you own the rights to
          something listed here (or represent someone who does) and want it taken down, use the{" "}
          <Link href="/takedown" style={{ color: "var(--bone)" }}>takedown form</Link>. Tell us which song or page and why.
          We aim to act within a few days. When we agree, the song is marked removed and any links we suggested
          for it are deleted; we&apos;ll reply by email either way. Please only send requests about music you have
          rights to.
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
