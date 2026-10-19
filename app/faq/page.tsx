// FAQ: plain answers to the questions new visitors and contributors ask.
// Each question is a <details> so the page stays short until you open one.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "FAQ · Static Cuts//",
  description: "How Static Cuts// works: what's in the archive, how songs get added, and how to help.",
};

type QA = { id?: string; q: string; a: React.ReactNode };
type Section = { id: string; title: string; items: QA[] };

const SECTIONS: Section[] = [
  {
    id: "basics",
    title: "The basics",
    items: [
      {
        q: "What is Static Cuts//?",
        a: (
          <p>
            A community-built discography archive. Every artist page lists everything we know they&apos;ve made:
            released songs, features, alternate versions, and songs that have been teased, snippeted or leaked but
            never officially released. It&apos;s run by fans and isn&apos;t a business.
          </p>
        ),
      },
      {
        q: "Can I listen to unreleased songs here?",
        a: (
          <p>
            No. We don&apos;t host audio and we don&apos;t link to leaked files. A song only gets a
            &ldquo;listen&rdquo; link when it&apos;s on an official service like Spotify, YouTube, SoundCloud or
            Bandcamp. For everything else, the archive records that the song exists, what&apos;s known about it and
            where that came from.
          </p>
        ),
      },
      {
        q: "Where does the information come from?",
        a: (
          <>
            <p>
              Three places: the community (people suggesting songs and corrections), official sources (Spotify,
              Genius and Last.fm, credited on each song they came from), and community spreadsheets imported with
              their makers&apos; permission.
            </p>
            <p>
              Spreadsheets are credited on every song they added and on the <Link href="/sources">sources page</Link>,
              where you can also send one in.
            </p>
          </>
        ),
      },
      {
        q: "An artist I like isn't here. Can they be added?",
        a: (
          <p>
            Yes. Search for them on the home page and, if they&apos;re not found, press &ldquo;suggest as a new
            artist&rdquo; (you&apos;ll need to be logged in). Once they&apos;re added, anyone can fill the page with
            &ldquo;import songs&rdquo;. Artists who only appear as a feature on someone else&apos;s song get their
            own page automatically once they&apos;re confirmed on Spotify.
          </p>
        ),
      },
    ],
  },
  {
    id: "statuses",
    title: "Song statuses",
    items: [
      {
        q: "What do the statuses mean?",
        a: (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><b>released</b>: officially out.</li>
            <li><b>announced</b>: confirmed by the artist or label, release coming.</li>
            <li><b>leaked</b>: the full song got out without an official release.</li>
            <li><b>snippet</b>: only a short clip has been heard.</li>
            <li><b>teased</b>: the artist has hinted at it or played it somewhere.</li>
            <li><b>rumored</b>: talked about, but nothing heard yet.</li>
            <li><b>unconfirmed</b>: nobody has checked yet.</li>
            <li><b>removed</b>: was out officially, then taken down.</li>
          </ul>
        ),
      },
      {
        q: "What's “real or fake?”",
        a: (
          <p>
            On rumoured, teased, snippet and leaked songs you can vote on whether you think the song is genuine.
            The totals are public; your own vote is only shown to you. Songs with a close vote are marked as disputed.
          </p>
        ),
      },
      {
        q: "What are sub-versions and alt versions?",
        a: (
          <p>
            Some songs exist in more than one form: an early demo, a version with a different feature, a remix.
            These sit underneath the main song on the artist page instead of cluttering the list. Use
            &ldquo;+ alt version&rdquo; in a song&apos;s &ldquo;more&rdquo; menu to add one.
          </p>
        ),
      },
    ],
  },
  {
    id: "contributing",
    title: "Helping out",
    items: [
      {
        q: "How do I add a song or fix a mistake?",
        a: (
          <>
            <p>
              Log in, open the artist, then use &ldquo;+ suggest track&rdquo; at the top, or &ldquo;more&rdquo; on any
              song for &ldquo;suggest edit&rdquo;, &ldquo;+ alt version&rdquo;, &ldquo;wrong link&rdquo; and
              &ldquo;shouldn&apos;t be here&rdquo;.
            </p>
            <p>
              Everything goes to a moderator before it goes live. You can follow what happened to each suggestion
              on <Link href="/my-submissions">my submissions</Link>.
            </p>
          </>
        ),
      },
      {
        q: "Is there something quick I can do?",
        a: (
          <p>
            <Link href="/help">Help wanted</Link> lists small jobs: checking whether a link is the right song (one
            listen and a vote), filling in missing release dates and albums, giving songs a status, and filling thin
            artist pages.
          </p>
        ),
      },
      {
        q: "Do I get credit?",
        a: (
          <p>
            Yes. Approved contributions count towards your profile and the{" "}
            <Link href="/contributors">contributors page</Link>, which ranks people for this month and all time.
          </p>
        ),
      },
      {
        q: "I have a spreadsheet of an artist's songs. Can it be imported?",
        a: (
          <p>
            Send the link on the <Link href="/sources">sources page</Link>. A moderator checks it, then imports it.
            Songs that aren&apos;t here yet go to the review list. For songs we already have, the sheet fills in blank
            statuses and missing details (and where it disagrees with us, a moderator decides). Every song keeps a
            credit to your sheet, and the sheet is re-checked now and then so changes get picked up. Leak file links
            in the sheet are left out.
          </p>
        ),
      },
      {
        q: "I track my own collection in a spreadsheet. Can I bring it?",
        a: (
          <p>
            Yes: <Link href="/collection/import">import my spreadsheet</Link> (also on your profile) ticks the songs you
            list in your collection here. Only your collection changes.
          </p>
        ),
      },
      {
        q: "What's a trusted contributor?",
        a: (
          <p>
            After 25 of your suggestions are approved (with no more than 1 in 5 turned down), your suggestions go live
            straight away instead of waiting for a moderator. Deleting songs and adding artists still always get
            checked. Your progress is on <Link href="/my-submissions">my submissions</Link>.
          </p>
        ),
      },
      {
        q: "What does “want it” do?",
        a: (
          <p>
            It&apos;s a vote for an unreleased song you want to hear. The votes make the{" "}
            <Link href="/wanted">most wanted</Link> lists, for every artist and overall.
          </p>
        ),
      },
      {
        q: "Can I get alerts on my phone?",
        a: (
          <p>
            Yes: turn on &ldquo;phone alerts&rdquo; in <Link href="/settings">settings</Link> on each device you want them
            on. On iPhone, add the site to your home screen first (Share → Add to Home Screen) and turn it on from
            there.
          </p>
        ),
      },
      {
        q: "What's the ChatGPT connection in settings?",
        a: (
          <p>
            An optional helper. If you connect ChatGPT, it can look for new songs and listen links for the artists
            you follow and send what it finds to the moderators. It can&apos;t change the archive directly or see
            your email, and you can disconnect it whenever you like.
          </p>
        ),
      },
    ],
  },
  {
    id: "account",
    title: "Your account",
    items: [
      {
        q: "What can I do with an account?",
        a: (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Follow artists, so your home page shows just them, and pin favourites to the top.</li>
            <li>Mark songs as collected and see how complete your collection is for each artist.</li>
            <li>Rate songs out of 10 and comment on them.</li>
            <li>Make <Link href="/lists">lists</Link> and follow other people&apos;s.</li>
            <li>Press &ldquo;remind me&rdquo; on an unreleased song to be told when it comes out or changes status.</li>
          </ul>
        ),
      },
      {
        q: "Can I put a list on Spotify?",
        a: (
          <p>
            Lists and profiles have &ldquo;export to Spotify&rdquo;, which makes a private playlist from the songs
            that have Spotify links. Unreleased songs can&apos;t go on Spotify, so they&apos;re skipped. While the
            site&apos;s Spotify app is in test mode, this only works for accounts that have been added to it.
          </p>
        ),
      },
      {
        q: "What's public on my profile?",
        a: (
          <p>
            Comments, lists (unless you make them private) and suggestions are public. Settings has a switch for
            each of the rest: completion, collected songs, ratings, followed artists and contributions. Your email
            is never shown. The <Link href="/legal">privacy page</Link> has the details.
          </p>
        ),
      },
    ],
  },
  {
    id: "moderators",
    title: "Moderating",
    items: [
      {
        id: "moderators",
        q: "Who are the moderators?",
        a: (
          <p>
            Trusted regulars who review suggestions, merge duplicates, import spreadsheets and handle reported
            comments. They can edit songs directly, and every change they make lands in an undo history.
          </p>
        ),
      },
      {
        q: "How do I become one?",
        a: (
          <p>
            Contribute for a while. Moderators are picked from people whose suggestions are consistently approved.
            There&apos;s no form; if you&apos;re a regular and want to help more, say so in the community.
          </p>
        ),
      },
      {
        q: "I saw a comment that shouldn't be there.",
        a: (
          <p>
            Press &ldquo;report&rdquo; under it. After three reports it&apos;s hidden until a moderator looks at it.
          </p>
        ),
      },
    ],
  },
  {
    id: "rights",
    title: "Rights and takedowns",
    items: [
      {
        q: "I own the rights to a song listed here. Can it be taken down?",
        a: (
          <p>
            Yes. Use the <Link href="/takedown">takedown form</Link> (also in the &ldquo;more&rdquo; menu on every
            song). Requests go straight to the admin, who replies by email.
          </p>
        ),
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <div className="wrap faq">
      <Link href="/" className="back-btn">← home</Link>
      <h1 className="detail-name page-title">FAQ</h1>
      <div className="detail-meta">How the archive works, and how to help build it.</div>
      <nav className="faq-jump" aria-label="Sections">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="tab">{s.title}</a>
        ))}
      </nav>
      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id}>
          <h2>{s.title}</h2>
          {s.items.map((qa) => (
            <details key={qa.q} id={qa.id && qa.id !== s.id ? qa.id : undefined}>
              <summary>{qa.q}</summary>
              <div>{qa.a}</div>
            </details>
          ))}
        </section>
      ))}
      <p className="detail-meta" style={{ marginTop: 28 }}>
        Something not covered here? Ask in the comments on any song, or check the{" "}
        <Link href="/legal" className="text-link">privacy &amp; terms</Link>.
      </p>
    </div>
  );
}
