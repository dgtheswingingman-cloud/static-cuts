// How to listen: what a listen link is, why many songs don't have one, and
// how to play songs you already have as files in Spotify.

import type { Metadata } from "next";
import InfoShell, { InfoSection } from "../components/info/InfoShell";

export const metadata: Metadata = {
  title: "How to listen · Static Cuts//",
  description: "Where the listen links come from, why some songs have none, and how to play your own files in Spotify.",
};

const SERVICES: { name: string; text: string; icon: React.ReactNode }[] = [
  { name: "Spotify", text: "Official releases, albums and most singles.",
    icon: <svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#1DB954" /><path d="M6.5 9.3c3.6-1.1 7.8-.8 11 1M7.2 12.3c3-.9 6.4-.6 9 .9M7.8 15.1c2.4-.6 5-.4 7 .8" stroke="#070707" strokeWidth="1.6" strokeLinecap="round" fill="none" /></svg> },
  { name: "Apple Music", text: "Official releases and albums, including some exclusives.",
    icon: <svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#FA2D48" /><path d="M10 17.5V8l8-1.6v9.4" stroke="#fff" strokeWidth="1.6" fill="none" /><circle cx="8.6" cy="17.5" r="1.8" fill="#fff" /><circle cx="16.6" cy="15.8" r="1.8" fill="#fff" /></svg> },
  { name: "Deezer", text: "Official releases, albums and a wide catalogue.",
    icon: <svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#A238FF" /><path d="M5 16h2.5M8.5 16h2.5M12 16h2.5M15.5 16H18M12 13h2.5M15.5 13H18M15.5 10H18M15.5 7H18" stroke="#fff" strokeWidth="2" /></svg> },
  { name: "YouTube & SoundCloud", text: "Official videos and uploads, and songs artists have posted themselves.",
    icon: <svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true"><rect x="1" y="5" width="22" height="14" rx="4" fill="#FF0000" /><path d="M10 9v6l5-3z" fill="#fff" /></svg> },
];

export default function ListenPage() {
  return (
    <InfoShell title="HOW TO LISTEN" here="/listen" intro="Where to listen to the songs on Static Cuts//, and how to play songs you already have as files."
      sections={[["where", "Where to listen"], ["files", "Songs you already have"], ["trouble", "If it doesn't work"]]}>
      <InfoSection id="where" title="Where to listen">
        <p className="if-p">Static Cuts// is a list of every song an artist is known to have made. It doesn&apos;t host or play music. When a song is somewhere you can play it, its page has a <b>listen</b> button that takes you there.</p>
        <div className="if-cards">
          {SERVICES.map((x) => (
            <div key={x.name} className="if-card">
              {x.icon}
              <span><strong>{x.name}</strong><small>{x.text}</small></span>
            </div>
          ))}
        </div>
        <div className="if-note">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></svg>
          <span>Unreleased songs only link to where they&apos;re already posted publicly. The site never hosts audio. No listen button just means we don&apos;t know of a place to play it yet; if you do, add it from the song&apos;s page.</span>
        </div>
      </InfoSection>

      <InfoSection id="files" title="Songs you already have as files">
        <p className="if-p">If you already have a song as a file (an MP3, say), Spotify can play it alongside everything else using its <b>Local Files</b> feature. This only plays files you already have: Spotify doesn&apos;t find or download them for you, and neither do we.</p>
        <h3 className="if-h3">On a computer (Windows or Mac)</h3>
        <ol className="im-steps">
          <li>Open the Spotify app (not the website: the website can&apos;t play files).</li>
          <li>Click your profile picture, then <b>Settings</b>.</li>
          <li>Find <b>Local Files</b> and turn on <b>Show Local Files</b>.</li>
          <li>Click <b>Add a source</b> and pick the folder your music is in.</li>
          <li>Your songs appear under <b>Your Library → Local Files</b>.</li>
        </ol>
        <h3 className="if-h3">On your phone (iPhone or Android)</h3>
        <ol className="im-steps">
          <li>Do the computer steps above first, then put the songs in a playlist on the computer.</li>
          <li>Have your phone and computer on the same Wi-Fi, signed in to the same Spotify account, with both apps open.</li>
          <li>On your phone, open that playlist and turn on <b>Download</b>. Give it a few minutes.</li>
        </ol>
        <p className="if-p if-dim">Android can also show files already on the phone: look in Spotify&apos;s settings for the local files or &ldquo;audio files from this device&rdquo; option. Phones need Spotify Premium for local files.</p>
      </InfoSection>

      <InfoSection id="trouble" title="If it doesn't work">
        <ul className="im-steps">
          <li>MP3 works best. FLAC, WAV and OGG don&apos;t play: convert them to MP3 first.</li>
          <li>Turn off any VPN while your phone copies the songs, and make sure neither app is in offline mode.</li>
          <li>Spotify sometimes renames these menus. If something isn&apos;t where we say, search Spotify&apos;s help for &ldquo;local files&rdquo;.</li>
        </ul>
      </InfoSection>
    </InfoShell>
  );
}
