"use client";

// Wide screens only (computers): the space either side of the page is used
// for a quick way around the site (left) and a live feed of what's changing
// in the archive (right). Phones and narrow windows never see these.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { usePersonalUser } from "./useIsAdmin";

type Group = {
  kind: "added" | "status"; artist_id: string; artist: string | null; to_status: string | null;
  count: number; at: string; tracks: { id: string; title: string }[];
};

const BROWSE: [string, string][] = [
  ["/", "Home"], ["/new", "What's new"], ["/radar", "Release radar"], ["/search", "Search"],
  ["/lists", "Lists"], ["/collabs", "Collab map"], ["/producers", "Producers"], ["/help", "Help wanted"],
  ["/on-this-day", "On this day"], ["/local", "Local Cuts"],
];

function ago(at: string) {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(at)) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export default function SideRails() {
  const path = usePathname();
  const user = usePersonalUser();
  const [feed, setFeed] = useState<Group[] | null>(null);
  const [mine, setMine] = useState<{ id: string; name: string }[]>([]);
  const [wide, setWide] = useState(false);

  // Only load anything on screens wide enough to show the rails.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1320px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    if (!wide) return;
    let stop = false;
    const load = async () => {
      const { data } = await supabase.rpc("rpc_whats_new", { p_before: null, p_kind: "all", p_following: false, p_days: 2 });
      const days = (data as { days?: { groups: Group[] }[] } | null)?.days ?? [];
      if (!stop) setFeed(days.flatMap((d) => d.groups).slice(0, 14));
    };
    load();
    const t = setInterval(load, 120000);
    return () => { stop = true; clearInterval(t); };
  }, [wide]);

  useEffect(() => {
    if (!wide || !user) { setMine([]); return; }
    supabase.from("follows").select("artist_id, artists!artist_id(name)").eq("user_id", user.id).limit(40)
      .then(({ data }) => setMine(((data ?? []) as any[])
        .map((r) => ({ id: r.artist_id as string, name: (r.artists?.name ?? r.artist_id) as string }))
        .sort((a, b) => a.name.localeCompare(b.name))));
  }, [wide, user]);

  if (!wide) return null;
  return (
    <>
      <aside className="rail rail-left" aria-label="Browse">
        <div className="rail-label">Browse</div>
        {BROWSE.map(([href, label]) => (
          <Link key={href} href={href} className={`rail-link ${path === href ? "on" : ""}`}>{label}</Link>
        ))}
        {mine.length > 0 && (
          <>
            <div className="rail-label" style={{ marginTop: 18 }}>Your artists</div>
            {mine.map((a) => (
              <Link key={a.id} href={`/artist/${a.id}`} className={`rail-link ${path === `/artist/${a.id}` ? "on" : ""}`}>{a.name}</Link>
            ))}
          </>
        )}
      </aside>
      <aside className="rail rail-right" aria-label="Live">
        <div className="rail-label"><span className="rail-dot" /> Live</div>
        {feed === null && <div className="rail-meta">loading…</div>}
        {feed && feed.length === 0 && <div className="rail-meta">Quiet for now.</div>}
        {feed?.map((g, i) => (
          <div key={i} className="rail-item">
            <div className="rail-meta">{ago(g.at)} ago</div>
            <Link href={`/artist/${g.artist_id}`} className="rail-artist">{g.artist ?? g.artist_id}</Link>
            <div className="rail-what">
              {g.kind === "added" ? `${g.count} new song${g.count === 1 ? "" : "s"}` : `${g.count} now ${g.to_status}`}
              {g.tracks[0] && (
                <>: <Link href={`/song/${g.tracks[0].id}`} className="rail-song">{g.tracks[0].title}</Link>{g.count > 1 ? "…" : ""}</>
              )}
            </div>
          </div>
        ))}
        <Link href="/new" className="rail-link" style={{ marginTop: 8 }}>everything new →</Link>
      </aside>
    </>
  );
}
