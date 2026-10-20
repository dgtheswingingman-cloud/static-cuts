// How to listen: what a listen link is, why many songs don't have one, and
// how to play songs you already have as files in Spotify.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to listen · Static Cuts//",
  description: "Where the listen links come from, why some songs have none, and how to play your own files in Spotify.",
};

export default function ListenPage() {
  return (
    <div className="wrap" style={{ maxWidth: 680 }}>
      <h1 className="detail-name page-title">How to listen</h1>

      <div className="section-label">What Static Cuts is (and isn&apos;t)</div>
      <p className="detail-meta">
        Static Cuts is a list of every song an artist is known to have made, with what we know about each one. It
        doesn&apos;t host or play music itself. When a song is somewhere you can play it, the song page has a{" "}
        <b>listen</b> button that takes you there (Spotify, YouTube or SoundCloud).
      </p>
      <p className="detail-meta">
        Lots of songs, especially unreleased ones, have no listen button. That just means we don&apos;t know of a
        place to play it yet. If you do, add it from the song&apos;s artist page so everyone can use it.
      </p>

      <div className="section-label" style={{ marginTop: 24 }}>Songs you already have as files</div>
      <p className="detail-meta">
        If you already have a song as a file (an MP3, say), Spotify can play it alongside everything else using its
        <b> Local Files</b> feature. This only plays files you already have: Spotify doesn&apos;t find or download
        them for you, and neither do we.
      </p>

      <div className="comments-panel" style={{ marginTop: 12 }}>
        <div className="review-row-title">On a computer (Windows or Mac)</div>
        <ol className="detail-meta" style={{ paddingLeft: 20, marginTop: 6 }}>
          <li>Open the Spotify app (not the website: the website can&apos;t play files).</li>
          <li>Click your profile picture, then <b>Settings</b>.</li>
          <li>Find <b>Local Files</b> and turn on <b>Show Local Files</b>.</li>
          <li>Click <b>Add a source</b> and pick the folder your music is in.</li>
          <li>Your songs appear under <b>Your Library → Local Files</b>.</li>
        </ol>
      </div>

      <div className="comments-panel" style={{ marginTop: 12 }}>
        <div className="review-row-title">On your phone (iPhone or Android)</div>
        <ol className="detail-meta" style={{ paddingLeft: 20, marginTop: 6 }}>
          <li>Do the computer steps above first, then put the songs in a playlist on the computer.</li>
          <li>Have your phone and computer on the same Wi-Fi, signed in to the same Spotify account, with both apps open.</li>
          <li>On your phone, open that playlist and turn on <b>Download</b>. Give it a few minutes.</li>
        </ol>
        <div className="comment-meta">
          Android can also show files already on the phone: look in Spotify&apos;s settings for the local files or
          &ldquo;audio files from this device&rdquo; option. Phones need Spotify Premium for local files.
        </div>
      </div>

      <div className="section-label" style={{ marginTop: 24 }}>If it doesn&apos;t work</div>
      <ul className="detail-meta" style={{ paddingLeft: 20 }}>
        <li>MP3 works best. FLAC, WAV and OGG don&apos;t play: convert them to MP3 first.</li>
        <li>Turn off any VPN while your phone copies the songs, and make sure neither app is in offline mode.</li>
        <li>Spotify sometimes renames these menus. If something isn&apos;t where we say, search Spotify&apos;s help for &ldquo;local files&rdquo;.</li>
      </ul>

      <p className="comment-meta" style={{ marginTop: 24 }}>
        More questions? See the <Link href="/faq" className="text-link">FAQ</Link>.
      </p>
    </div>
  );
}
