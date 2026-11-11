// The Static Cuts Discord bot: what it does, and the button to add it to a server.

import type { Metadata } from "next";
import InfoShell, { InfoSection } from "../components/info/InfoShell";

export const metadata: Metadata = {
  title: "Discord bot · Static Cuts//",
  description: "Add Static Cuts// to your Discord server: song of the day, album of the week, and new leaks, snippets and releases from the artists you care about.",
};

// Discord's "add this bot to a server" page (view channels, send messages, embed links; slash commands).
const INVITE = "https://discord.com/oauth2/authorize?client_id=1568259437398073445&permissions=19456&scope=bot%20applications.commands";

const COMMANDS: [string, string][] = [
  ["/daily on", "Song of the day, album of the week on Mondays and the monthly roundup on the 1st, in this channel from 10am (UK time). Add on_this_day: True for three songs from this date in past years too."],
  ["/alerts add <artist>", "New leaks, snippets and releases for an artist, posted here as they land. Up to 25 artists a channel."],
  ["/song <name>", "Look up a song: its status, era and page."],
  ["/artist <name>", "An artist's numbers: songs, unreleased, leaked, and the latest leaks."],
  ["/leaks", "The latest leaks, on the whole site or for one artist."],
];

export default function DiscordPage() {
  return (
    <InfoShell title="DISCORD BOT" here="/discord" intro="Put Static Cuts// in your Discord server: the daily picks, and updates from the artists your server cares about."
      sections={[["add", "Add it"], ["commands", "Commands"]]}>
      <InfoSection id="add" title="Add it to your server">
        <p className="if-p">You need to be able to manage the server. Pick the server, keep the permissions as they are (read and send messages, show links), and it&apos;s in.</p>
        <a className="tab dc-add" href={INVITE} target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18 18 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9 0 13.6.3 18.1a19.7 19.7 0 0 0 6 3l1.3-2a12.8 12.8 0 0 1-2-1l.5-.4a14 14 0 0 0 11.8 0l.5.4-2 1 1.3 2a19.6 19.6 0 0 0 6-3c.4-5.2-.7-9.7-3.4-13.7ZM8.5 15.4c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Zm7 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Z" /></svg>
          Add to Discord
        </a>
        <p className="if-p if-dim">Then, in the channel you want, type <b>/daily on</b> for the daily picks and <b>/alerts add</b> for an artist. Setting these up needs Manage Channels.</p>
      </InfoSection>

      <InfoSection id="commands" title="Commands">
        <div className="if-cards">
          {COMMANDS.map(([c, t]) => (
            <div key={c} className="if-card">
              <span><strong className="dc-cmd">{c}</strong><small>{t}</small></span>
            </div>
          ))}
        </div>
        <p className="if-p if-dim">Links only ever go to pages on Static Cuts//, never to files.</p>
      </InfoSection>
    </InfoShell>
  );
}
