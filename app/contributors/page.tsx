"use client";

// Who's been building the archive: approved songs, versions, status updates,
// corrections, finds and confirmations, for the last 30 days or all time.
// Top three on a podium, then the rest, then where you are. Only people who
// show their contributions publicly are listed.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePersonalUser } from "../useIsAdmin";
import Supporter from "../components/Supporter";

type Row = {
  user_id: string; display_name: string | null; avatar_url: string | null;
  total: number; songs: number; versions: number; status: number; corrections: number; finds: number; confirmations: number;
};

const PARTS: [keyof Row, string, string][] = [
  ["songs", "song added", "songs added"],
  ["versions", "version", "versions"],
  ["status", "status update", "status updates"],
  ["corrections", "fix", "fixes"],
  ["finds", "find", "finds"],
  ["confirmations", "confirmation", "confirmations"],
];
const n0 = (x: number) => Number(x).toLocaleString("en-GB");

function Face({ url, size }: { url: string | null; size: number }) {
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt="" className="ms-avatar" style={{ width: size, height: size }} loading="lazy" />
    : <span className="ms-avatar ms-avatar-blank" style={{ width: size, height: size }} />;
}

export default function ContributorsPage() {
  const me = usePersonalUser();
  const [period, setPeriod] = useState<"30" | "all">("30");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [showing, setShowing] = useState<boolean | null>(null);
  const [trusted, setTrusted] = useState(false);

  useEffect(() => {
    setRows(null);
    supabase.rpc("rpc_top_contributors", { p_days: period === "30" ? 30 : null, p_limit: 200 })
      .then(({ data }) => setRows((data as Row[]) ?? []));
  }, [period]);

  useEffect(() => {
    if (!me) return;
    supabase.from("profiles").select("show_contributions").eq("id", me.id).maybeSingle()
      .then(({ data }) => setShowing(!!(data as { show_contributions: boolean } | null)?.show_contributions));
    supabase.rpc("rpc_my_trust").then(({ data }) => setTrusted(!!(data as { trusted?: boolean } | null)?.trusted));
  }, [me]);

  const top = (rows ?? []).slice(0, 3);
  const rest = (rows ?? []).slice(3, 50);
  const myIdx = me ? (rows ?? []).findIndex((r) => r.user_id === me.id) : -1;
  const mine = myIdx >= 0 ? rows![myIdx] : null;
  // Podium order on wide screens: #2, #1, #3.
  const podium = top.length === 3 ? [top[1], top[0], top[2]] : top;

  const breakdown = (r: Row, short = false) => PARTS.filter(([k]) => Number(r[k]) > 0)
    .map(([k, one, many]) => short ? n0(Number(r[k])) : `${n0(Number(r[k]))} ${Number(r[k]) === 1 ? one : many}`).join(" · ");

  return (
    <div className="wrap cb-page">
      <h1 className="ls-title cb-title">CONTRIBUTORS<span>//</span></h1>
      <p className="sb-lead">Who&apos;s been building the archive.</p>

      <nav className="rd-chips nt-chips cb-chips" aria-label="Period">
        <button className={period === "30" ? "on" : undefined} aria-pressed={period === "30"} onClick={() => setPeriod("30")}>Last 30 days</button>
        <button className={period === "all" ? "on" : undefined} aria-pressed={period === "all"} onClick={() => setPeriod("all")}>All time</button>
      </nav>

      {rows === null && <div className="empty-state">loading…</div>}
      {rows && rows.length === 0 && <div className="empty-state">Nobody yet{period === "30" ? " this month" : ""}. Be the first.</div>}

      {top.length > 0 && (
        <div className={`cb-podium n${top.length}`}>
          {podium.map((r) => {
            const rank = rows!.indexOf(r) + 1;
            return (
              <Link key={r.user_id} href={`/profile/${r.user_id}`} className={`cb-pod r${rank}`}>
                <span className="cb-rank">#{rank}</span>
                {me?.id === r.user_id && trusted && <span className="sb-trusted cb-trusted">Trusted ✓</span>}
                <Face url={r.avatar_url} size={rank === 1 ? 96 : 80} />
                <strong className="cb-name">{r.display_name || "unnamed"}<Supporter id={r.user_id} /></strong>
                <span className="cb-total">{n0(r.total)}</span>
                <span className="cb-total-label">approved contributions</span>
                <span className="cb-break">{breakdown(r)}</span>
              </Link>
            );
          })}
        </div>
      )}

      {rest.length > 0 && (
        <div className="cb-table">
          <div className="cb-th"><span>#</span><span>Contributor</span><span>Total</span></div>
          {rest.map((r, i) => (
            <Link key={r.user_id} href={`/profile/${r.user_id}`} className={`cb-row ${me?.id === r.user_id ? "me" : ""}`}>
              <span className="cb-row-rank">#{i + 4}</span>
              <Face url={r.avatar_url} size={40} />
              <span className="cb-row-text">
                <strong>{r.display_name || "unnamed"}<Supporter id={r.user_id} /></strong>
                <small>{breakdown(r)}</small>
              </span>
              <span className="cb-row-total">{n0(r.total)}</span>
            </Link>
          ))}
        </div>
      )}

      {me && rows && (
        <div className="cb-you">
          {mine ? (
            <Link href={`/profile/${me.id}`} className="cb-you-row">
              <span>You</span><span className="cb-dot">·</span><strong>#{myIdx + 1}</strong><span className="cb-dot">·</span>
              <span>{n0(mine.total)} contribution{Number(mine.total) === 1 ? "" : "s"}{period === "30" ? " this month" : ""}</span>
              {trusted && <span className="sb-trusted">Trusted ✓</span>}
            </Link>
          ) : (
            <div className="cb-you-row">
              <span>You</span><span className="cb-dot">·</span>
              <span>{showing === false
                ? <>Your contributions are private, so you&apos;re not listed. <Link href="/settings" className="text-link">Show them in Settings</Link>.</>
                : <>Not on the board yet{period === "30" ? " this month" : ""}.</>}</span>
            </div>
          )}
        </div>
      )}

      <div className="nw-panel cb-cta">
        <span className="cb-cta-text">
          <strong>Want to be on here?</strong>
          <span>Suggest songs, fix details or set up ChatGPT. Approved ones count.</span>
        </span>
        <Link href="/submit" className="cb-cta-btn">Suggest//</Link>
      </div>
    </div>
  );
}
