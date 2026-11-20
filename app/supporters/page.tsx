"use client";

// Supporters wall: premium members and founders who chose to be listed
// (Settings → Privacy). Founders first, by number; then everyone else by
// when they joined.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePremium } from "../usePremium";
import "../styles/pages.css";
import "../styles/supporters.css";

type Row = { user_id: string; display_name: string | null; avatar_url: string | null; founder: number | null; since: string | null };

export default function SupportersPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const { premium } = usePremium();

  useEffect(() => {
    supabase.rpc("rpc_supporters").then(({ data }) => setRows((data as Row[] | null) ?? []));
  }, []);

  return (
    <div className="wrap pg-page">
      <div className="pg-kicker">Thank you</div>
      <h1 className="detail-name page-title pg-title">Supporters</h1>
      <p className="pg-lead">
        The people paying for Static-Cuts// premium keep the archive running and free for everyone.
        {" "}Only supporters who&apos;ve chosen to be listed are shown.
      </p>

      {!rows && <div className="empty-state">loading…</div>}
      {rows && rows.length === 0 && <div className="empty-state">No one listed yet. Supporters can add themselves in Settings.</div>}
      {rows && rows.length > 0 && (
        <ul className="sw-grid">
          {rows.map((r) => (
            <li key={r.user_id}>
              <Link href={`/profile/${r.user_id}`} className="sw-card">
                {r.avatar_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={r.avatar_url} alt="" className="sw-face" loading="lazy" />
                  : <span className="sw-face sw-face-blank" />}
                <span className="sw-name">{r.display_name ?? "unnamed"}</span>
                <span className="sw-meta">
                  {r.founder ? <b>◆ founder #{r.founder}</b> : <span>◆ supporter</span>}
                  {r.since && <span> · since {new Date(r.since).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="sw-foot">
        {premium
          ? <>Want to be on the wall? Turn on &ldquo;Show me on the supporters wall&rdquo; in <Link className="text-link" href="/settings">Settings</Link>.</>
          : <>Want to help? <Link className="text-link" href="/premium">Go premium →</Link></>}
      </p>
    </div>
  );
}
