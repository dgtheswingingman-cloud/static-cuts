import type { Metadata } from "next";
import Link from "next/link";
import InfoShell, { InfoSection } from "../components/info/InfoShell";

export const metadata: Metadata = { title: "Privacy & terms · Static-Cuts//" };

export default function LegalPage() {
  return (
    <InfoShell title="PRIVACY & TERMS" here="/legal" intro="How your data is used and the rules for using Static-Cuts//. Last updated 11 November 2026."
      sections={[["plain", "In plain English"], ["privacy", "Privacy"], ["terms", "Terms"], ["premium", "Premium & payments"]]}>
      <InfoSection id="plain" title="In plain English" className="if-plain">
        <p className="if-p">
          We keep your account, library and preferences private. Your profile only shows what you choose to show.
          We don&apos;t sell your data, we don&apos;t show ads, and we only collect what&apos;s needed to run the site. The site
          doesn&apos;t host audio. Static-Cuts// is a small, community-run project. The archive is free; Premium is an
          optional subscription that adds tools on top and pays for running the site. Card payments are handled by
          Stripe, and we never see your card details. This page is written plainly on purpose; it isn&apos;t a
          substitute for legal advice.
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
        <p>
          If you buy Premium, the payment is made on Stripe&apos;s checkout page and Stripe processes it under its own{" "}
          <a href="https://stripe.com/gb/privacy" className="text-link" target="_blank" rel="noopener noreferrer">privacy policy</a>.
          Stripe receives your email, card details and billing country; we receive only a Stripe customer number, your
          plan, and whether your subscription is active and until when. We never see or store your card number.
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
        <p>
          If you have Premium, cancel it before deleting your account (see Premium &amp; payments below). Stripe keeps
          records of past payments for as long as the law requires.
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
          Static-Cuts// doesn&apos;t host audio, but we respect artists and rights holders. If you own the rights to
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
          The archive is a community project, maintained by volunteers, provided as-is. Things may occasionally
          break, change, or move — there&apos;s no formal uptime commitment behind it. If a Premium feature you pay
          for stops working, tell us and we&apos;ll fix it or make it right (see Premium &amp; payments).
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
      <InfoSection id="premium" title="Premium & payments">
          <details className="if-q">
            <summary>What you&apos;re buying</summary>
            <div className="if-a">
        <p>
          Premium is a subscription to extra features on Static-Cuts// (listed on the{" "}
          <Link href="/premium" className="text-link">Premium page</Link>), monthly or yearly. The archive itself, and
          contributing to it, stay free. Prices are shown on the Premium page and at checkout, in pounds, including
          any VAT that applies. Features may be added, improved or changed over time; we won&apos;t take away the main
          ones you signed up for without telling you first.
        </p>
            </div>
          </details>
          <details className="if-q">
            <summary>Renewing and cancelling</summary>
            <div className="if-a">
        <p>
          Your subscription renews automatically at the end of each month or year, on the card you paid with, until
          you cancel. You can cancel any time from &ldquo;Manage or cancel&rdquo; on the{" "}
          <Link href="/premium" className="text-link">Premium page</Link>; you keep Premium until the end of the period
          you&apos;ve already paid for, and you won&apos;t be charged again. You can also switch between monthly and
          yearly there, or update your card and see your receipts.
        </p>
        <p>
          If a payment fails, Stripe will try again for a few days and you keep Premium meanwhile; if it still
          can&apos;t take payment, Premium ends.
        </p>
            </div>
          </details>
          <details className="if-q">
            <summary>Refunds</summary>
            <div className="if-a">
        <p>
          Changed your mind? If you email{" "}
          <a href="mailto:hello@static-cuts.com" className="text-link">hello@static-cuts.com</a> within 14 days of
          first paying for Premium, you&apos;ll get a full refund, no questions asked. After that, payments
          aren&apos;t refunded for the part of a period already started, but cancelling stops any future charges.
          If you were charged by mistake, or Premium didn&apos;t work for you because of a problem on our side, get in
          touch and we&apos;ll put it right. Nothing here affects your legal rights as a consumer.
        </p>
            </div>
          </details>
          <details className="if-q">
            <summary>Price changes, and if things end</summary>
            <div className="if-a">
        <p>
          If the price changes, we&apos;ll email you at least 30 days before it applies to you, so you can cancel first
          if you like. If we ever have to close Static-Cuts// or stop Premium, we&apos;ll refund the unused part of any
          period you&apos;ve paid for. If an account is removed for breaking these terms (for example repeated bad-faith
          submissions or abuse), its Premium ends; we&apos;ll refund the unused part unless the abuse involved Premium
          itself.
        </p>
            </div>
          </details>
          <details className="if-q">
            <summary>Who you&apos;re paying</summary>
            <div className="if-a">
        <p>
          Static-Cuts// is run by an individual in the United Kingdom. Payments show on your statement as
          STATIC-CUTS.COM. For anything about a payment, email{" "}
          <a href="mailto:hello@static-cuts.com" className="text-link">hello@static-cuts.com</a>; your receipts from
          Stripe also include our contact details.
        </p>
            </div>
          </details>
      </InfoSection>
    </InfoShell>
  );
}
