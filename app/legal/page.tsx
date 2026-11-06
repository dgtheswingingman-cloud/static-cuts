import type { Metadata } from "next";
import Link from "next/link";
import InfoShell, { InfoSection } from "../components/info/InfoShell";

export const metadata: Metadata = { title: "Privacy & terms · Static Cuts//" };

export default function LegalPage() {
  return (
    <InfoShell title="PRIVACY & TERMS" here="/legal" intro="How your data is used and the rules for using Static Cuts//. Last updated 18 October 2026."
      sections={[["plain", "In plain English"], ["privacy", "Privacy"], ["terms", "Terms"]]}>
      <InfoSection id="plain" title="In plain English" className="if-plain">
        <p className="if-p">
          We keep your account, library and preferences private. Your profile only shows what you choose to show.
          We don&apos;t sell your data, we don&apos;t show ads, and we only collect what&apos;s needed to run the site. The site
          doesn&apos;t host audio. Static Cuts// is a small, non-commercial, community-run project, written plainly on
          purpose; it isn&apos;t a substitute for legal advice.
        </p>
      </InfoSection>
      <InfoSection id="privacy" title="Privacy">
          <details className="if-q">
            <summary>What we collect</summary>
            <div className="if-a">
        <p>
          An account (email and password, or a Spotify login), a display name, and anything you
          choose to add — an avatar, an about section. Your activity on the site: ratings you give
          tracks, comments you post, which tracks you&apos;ve marked collected, which artists you
          follow or pin, and any submissions (new tracks, corrections, flags) you make.
        </p>
            </div>
          </details>
          <details className="if-q">
            <summary>What&apos;s public vs. private</summary>
            <div className="if-a">
        <p>
          Comments and submissions are public by nature — that&apos;s how the archive gets built.
          Your profile has individual toggles for showing your completion percentage, collected tracks,
          ratings, followed artists and contributions to other people. Your email and password are never
          shown to anyone, including other admins.
        </p>
        <p>
          Lists you make are public unless you make them private. Votes (real-or-fake, link votes) are counted
          publicly, but who voted which way isn&apos;t shown. Ratings work the same way. Reports on comments
          are only seen by moderators. Notifications and &ldquo;remind me&rdquo; are private to you, and you can turn the
          daily summary off in settings.
        </p>
            </div>
          </details>
          <details className="if-q">
            <summary>Third parties involved</summary>
            <div className="if-a">
        <p>
          The site runs on Supabase (database, accounts, file storage) and is hosted on Vercel. If
          you log in with Spotify, Spotify handles that authentication directly — we only receive
          what&apos;s needed to identify your account. Search-assist tooling used behind the scenes
          (for finding official links) doesn&apos;t touch your personal data at all.
        </p>
        <p>
          Some song information (titles, release dates, albums and links) comes from Spotify, Genius and Last.fm,
          credited on each song it came from. If you connect ChatGPT to your account to help keep artists up to
          date, it can read the catalogue and your followed artists and send finds for review; it can&apos;t change
          the archive or see your email. You can disconnect it at any time.
        </p>
        <p>
          Some songs come from community spreadsheets, imported with their makers&apos; permission and credited on
          each song and on the <a href="/sources" className="text-link">sources page</a>. Artwork and producer
          credits come from Spotify and Genius. Exporting to a Spotify playlist signs in to Spotify in your browser
          only: we don&apos;t store that sign-in.
        </p>
            </div>
          </details>
          <details className="if-q">
            <summary>Your data, your choice</summary>
            <div className="if-a">
        <p>
          You can change or delete anything in your profile at any time. In Settings, under &ldquo;Your data&rdquo;,
          you can download everything you&apos;ve put in as one file, or delete your account. Deleting removes your
          follows, collection, ratings, lists, votes and settings; approved suggestions stay in the archive without
          your name, and your comments are replaced with &ldquo;[deleted]&rdquo;.
        </p>
            </div>
          </details>
      </InfoSection>
      <InfoSection id="terms" title="Terms">
          <details className="if-q">
            <summary>What this is</summary>
            <div className="if-a">
        <p>
          A community-maintained discography archive — tracking metadata (titles, dates, producers,
          links to where a track can legitimately be found) for official and unreleased material
          alike, without popularity bias. <b className="text-link">This site does not
          host, store, or distribute audio files.</b> Every link points to a real external platform
          (Spotify, and similar) — we track information about music, not the music itself.
        </p>
            </div>
          </details>
          <details className="if-q">
            <summary>Contributing</summary>
            <div className="if-a">
        <p>
          Submissions go through review before anything you contribute becomes visible in the
          archive. Be accurate, be respectful in comments, and don&apos;t submit anything you know
          to be false. Repeated bad-faith submissions or abusive behavior toward other users can
          result in your account being restricted or removed.
        </p>
            </div>
          </details>
          <details className="if-q" id="takedowns">
            <summary>Takedowns</summary>
            <div className="if-a">
        <p>
          Static Cuts// doesn&apos;t host audio, but we respect artists and rights holders. If you own the rights to
          something listed here (or represent someone who does) and want it taken down, use the{" "}
          <Link href="/takedown" className="text-link">takedown form</Link> or email{" "}
          <a href="mailto:takedown@static-cuts.com" className="text-link">takedown@static-cuts.com</a>. Tell us which song or page and why.
          We aim to act within a few days. When we agree, the song is marked removed and any links we suggested
          for it are deleted; we&apos;ll reply by email either way. Please only send requests about music you have
          rights to.
        </p>
            </div>
          </details>
          <details className="if-q" id="contact">
            <summary>Contact</summary>
            <div className="if-a">
        <p>
          Questions, problems or anything else: <a href="mailto:hello@static-cuts.com" className="text-link">hello@static-cuts.com</a>.
          Rights holders: <a href="mailto:takedown@static-cuts.com" className="text-link">takedown@static-cuts.com</a>{" "}
          or the <Link href="/takedown" className="text-link">takedown form</Link>.
        </p>
            </div>
          </details>
          <details className="if-q">
            <summary>No guarantees</summary>
            <div className="if-a">
        <p>
          This is a hobby project, maintained by volunteers, provided as-is. Things may occasionally
          break, change, or move — there&apos;s no formal uptime or support commitment behind it.
        </p>
            </div>
          </details>
          <details className="if-q">
            <summary>Changes</summary>
            <div className="if-a">
        <p>
          These terms may be updated as the site grows. Meaningful changes will be reflected in the
          "last updated" date at the top of this page.
        </p>
            </div>
          </details>
      </InfoSection>
    </InfoShell>
  );
}
