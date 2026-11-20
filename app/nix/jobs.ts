// What each NIX job is for, in plain words, grouped. A job missing from here
// still shows on the NIX page (under "Other") with its name.

export const JOB_GROUPS: { title: string; jobs: Record<string, string> }[] = [
  {
    title: "Finding songs",
    jobs: {
      "deezer-sync": "Reads every artist's releases on Deezer: adds missing released songs and fills in albums, dates, covers and lengths.",
      "import-artist:genius": "Looks up an artist's songs on Genius and puts new ones in the review list.",
      "genius-auto-add": "Adds clear-cut Genius songs without review (switch in Owner).",
      "import-artist:lastfm": "Looks up an artist's most-played songs on Last.fm and puts new ones in the review list.",
      "sheet-import": "Re-reads community tracker sheets that are due.",
      "artist-growth": "Adds new artists (up to the daily number) once Deezer has read every artist here.",
      "queue-searched-artists": "Names people searched for and didn't find go to the front of the new-artist queue.",
      "import-queue-sweep": "Dismisses import suggestions for songs that are already on the page.",
    },
  },
  {
    title: "Filling in details",
    jobs: {
      "match-spotify": "Adds Spotify links by reading artists' releases on Spotify (Spotify only allows a few calls).",
      "apple-music": "Adds Apple Music links to songs.",
      "song-check:apple": "Checks songs against Apple Music: released or not, dates, albums.",
      "song-check:deezer": "Checks songs against Deezer: released or not, dates, albums.",
      "musicbrainz-sync": "Fills in band members from MusicBrainz.",
      "genius-credits": "Fills in producers, features, dates and artwork from Genius.",
      "discogs-sync": "Reads physical releases from Discogs: which albums came out on vinyl, CD or cassette.",
      "listenbrainz-sync": "Reads play counts from ListenBrainz, plus Cover Art Archive covers for songs with none.",
      "wikipedia-sync": "Adds artist bios from Wikipedia (found through MusicBrainz, never by name, with a link back).",
      "deezer-fans": "Reads each artist's Deezer fan count once a month, for how big they are in the home page mix.",
      "artist-info": "Fills in artist photos, about text and genres.",
      "artist-photos": "Adds photos to artists' photo pools from Deezer and TheAudioDB (only when it's clearly the same artist).",
      "youtube-search": "Finds YouTube links for songs with no link.",
      "album-track-linking": "Puts songs onto their albums' tracklists where the title matches exactly one song (your tracklist fixes always win).",
      "prerelease-step": "Marks announced songs as released on their release day.",
    },
  },
  {
    title: "Covers",
    jobs: {
      "fetch-covers": "Fills in missing artwork from Spotify.",
      "cover-search": "Finds covers through Deezer and Apple links or an exact Deezer search, launch artists first.",
      "covers-known": "Fills covers from the album they're on, then works out era art for unreleased songs.",
      "cover-copy": "Copies covers you approved on the Covers page into the site's own storage and puts them live.",
      "soundcloud-covers": "Uses SoundCloud artwork for songs that only have a SoundCloud link.",
    },
  },
  {
    title: "Tidying up",
    jobs: {
      "version-ai": "Claude checks the sub-version suggestions: clear ones applied (undoable), unsure ones left for you.",
      "versions-tidy": "Approves “same song?” suggestions that are beyond doubt (within one artist), then updates statuses from linked versions.",
      "version-rescan": "Runs a sub-versions rescan when you press rescan.",
      "duplicates": "Finds possible duplicate songs, then merges the ones that are beyond doubt (same Spotify link, ISRC, or album and length). Less sure ones wait on Duplicates.",
      "title-cleanup": "Cuts download-site tags out of song titles, keeping the old title as an alias.",
      "title-checks": "Finds titles that look cut off or wrong, for the Clean-up page.",
      "possible-editions": "Finds albums that are probably a deluxe of another album, for you to combine on Albums.",
    },
  },
  {
    title: "Guest artists",
    jobs: {
      "guest-artists": "Checks featured artists on Deezer: links them to their page here, or saves them for a new page.",
      "guest-refresh": "Updates the guest list and moves songs onto guests' pages.",
    },
  },
  {
    title: "Checking links",
    jobs: {
      "check-links": "Checks YouTube and SoundCloud links still work.",
      "verify-spotify-links": "Re-checks old Spotify links and clears removed ones.",
    },
  },
  {
    title: "Posts and picks",
    jobs: {
      "social-posts": "Makes the day's posts: song of the day, on this day, album of the week on Mondays, the roundup on the 1st.",
      "aotw-shortlist": "Builds next week's album of the week shortlist.",
      "aotw-blurb": "Claude writes a short blurb for each album on the album of the week shortlist.",
      "discord": "Posts artist alerts and the daily picks to Discord servers that asked for them.",
    },
  },
  {
    title: "Keeping pages fast",
    jobs: {
      "home-cache": "Saves a copy of the home page feed.",
      "caches": "Counts each artist's songs, works out genre scores and saves the release radar.",
      "whats-new-warm": "Keeps the What's new page ready (last 3 and 7 days).",
      "review-counts": "Counts what's waiting on Duplicates, Deezer check and Clean-up for the control room.",
      "top-contributors": "Works out the top contributors on the home page and the monthly roundup.",
      "visitor-stats": "Works out the headline numbers on the first-visit home page.",
      "collab-cache": "Saves the collab map's data.",
      "collab-edges": "Works out who has worked with whom, then saves the collab map.",
      "sitemap": "Saves the song list search engines read.",
    },
  },
  {
    title: "Alerts",
    jobs: {
      "send-push": "Sends phone alerts.",
      "radar-daily": "Release-day reminders.",
      "follow-digest": "Daily summary of followed artists.",
      "background-check": "Tells you in Alerts if jobs fail or NIX falls behind.",
    },
  },
  {
    title: "Housekeeping",
    jobs: {
      "undo-trim": "Clears old undo history (automatic changes after 7 days, people's after 60).",
      "cron-history-trim": "Clears job logs older than 3 days.",
      "api-budget-tidy": "Clears old API allowance counts.",
    },
  },
];

// Calendar timers that stay outside NIX (weekly / monthly), and NIX's own ticks.
export const CALENDAR: Record<string, string> = {
  "nix-tick": "NIX's clock for the outside-service jobs. Every minute.",
  "nix-sql-tick": "NIX's clock for the in-database jobs. Every minute.",
  "aotw-shortlist": "Builds next week's album of the week shortlist. Thursdays, 09:17.",
  "bio-mixups": "Flags artist bios that may describe a different artist. Mondays.",
  "contributor-rewards": "Gives the top contributors their free month. 1st of the month.",
  "claude-check": "The old Claude check. Switched off: the ChatGPT routines do this now.",
};

export const KNOWN_JOBS = new Set(JOB_GROUPS.flatMap((g) => Object.keys(g.jobs)));
