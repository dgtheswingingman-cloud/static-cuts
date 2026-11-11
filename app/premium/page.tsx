// Static-Cuts Premium: what it gets you, the two plans (paid on Stripe's
// checkout), and "manage or cancel" for people who already pay.

import type { Metadata } from "next";
import InfoShell, { InfoSection } from "../components/info/InfoShell";
import Plans from "./Plans";

export const metadata: Metadata = {
  title: "Premium · Static-Cuts//",
  description: "Static-Cuts// Premium: Local Cuts for tidying, tagging and organising your music files, a premium profile and the ◆ supporter badge.",
};

const PERKS: [string, string, string][] = [
  ["Local Cuts", "#F5B841", "Drop in a folder and get back a clean copy: titles with features, artist, album or “Unreleased <year>”, year, track numbers, cover art and the song's Static-Cuts code, in Artist / Album folders ready for Spotify Local Files."],
  ["Claude on the leftovers", "#8B7CF6", "Files that can't be matched by their tags get a second look from Claude, which works out what they are."],
  ["Premium profile", "#22D3EE", "A profile colour, a GIF avatar, up to 3 fan badges and a showcase of 6 pinned songs."],
  ["◆ Supporter badge", "#2BD67B", "Next to your name everywhere on the site. And you keep the archive running."],
];

export default function PremiumPage() {
  return (
    <InfoShell title="PREMIUM" here="/premium" intro="Everything on the archive stays free. Premium adds the tools on top, and pays for the servers."
      sections={[["plans", "Plans"], ["perks", "What you get"], ["faq", "Questions"]]}>
      <InfoSection id="plans" title="Plans">
        <Plans />
      </InfoSection>

      <InfoSection id="perks" title="What you get">
        <div className="if-cards">
          {PERKS.map(([t, c, d]) => (
            <div key={t} className="if-card">
              <span><strong>{t} <span style={{ color: c }}>//</span></strong><small>{d}</small></span>
            </div>
          ))}
        </div>
      </InfoSection>

      <InfoSection id="faq" title="Questions">
        <p className="if-p"><b>Can I cancel?</b> Any time, from “Manage or cancel” on this page. You keep premium until the end of what you&apos;ve paid for.</p>
        <p className="if-p"><b>Can I switch plans?</b> Yes, monthly to yearly or back, from the same place. Stripe works out the difference.</p>
        <p className="if-p"><b>Changed your mind?</b> Email hello@static-cuts.com within 14 days of first paying and you&apos;ll get a full refund. The full details are in <a href="/legal#premium" className="text-link">Premium &amp; payments</a>.</p>
        <p className="if-p"><b>Who handles the payment?</b> Stripe. Your card details go to them, never to Static-Cuts//.</p>
        <p className="if-p if-dim">“Help the archive” in Local Cuts (matching your files and filling gaps) stays free for everyone.</p>
      </InfoSection>
    </InfoShell>
  );
}
