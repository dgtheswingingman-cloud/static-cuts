"use client";

// /desktop: the Static-Cuts desktop app (Windows), premium only. The download
// is a 10-minute link from the desktop-download edge function, which checks
// premium; the installer itself is in a private storage bucket.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { usePremium } from "../usePremium";
import "../styles/pages.css";
import "../styles/desktop.css";

type Release = { version: string; size: number | null; created_at: string };

export default function DesktopPage() {
  const { user, loading } = useAuth();
  const { premium } = usePremium();
  const [rel, setRel] = useState<Release | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("desktop_releases").select("version, size, created_at").eq("platform", "windows")
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setRel((data as Release | null) ?? null));
  }, []);

  async function download() {
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.functions.invoke("desktop-download", { body: {} });
    setBusy(false);
    const url = (data as { url?: string } | null)?.url;
    if (url) { window.location.href = url; return; }
    let msg = (data as { error?: string } | null)?.error ?? null;
    if (!msg && error) {
      try { msg = ((await (error as { context?: Response }).context?.json()) as { error?: string })?.error ?? null; } catch { /* fall through */ }
    }
    setErr(msg ?? "The download couldn't start. Try again in a minute.");
  }

  const mb = rel?.size ? `${Math.max(1, Math.round(rel.size / 1e6))} MB` : null;

  return (
    <div className="wrap pg-page">
      <div className="pg-kicker">Premium · Windows</div>
      <h1 className="detail-name page-title pg-title">Desktop app</h1>
      <p className="pg-lead">
        Local Cuts on your computer, on its own. Pick the folder your music lands in once, and every new song is matched,
        tagged, given its cover and filed into your tidy library as soon as it arrives, even with the window closed.
      </p>

      <div className="dk-card">
        {loading ? <p className="dk-muted">…</p>
          : !user ? <p><Link className="text-link" href="/login?next=/desktop">Log in</Link> to download the app.</p>
          : !premium ? <p>The desktop app is part of premium. <Link className="text-link" href="/premium">Go premium →</Link></p>
          : rel === null ? <p className="dk-muted">The first download isn&apos;t up yet. Check back soon.</p>
          : (
            <>
              <button className="dk-btn" disabled={busy || rel === undefined} onClick={download}>
                {busy ? "Getting your download…" : "Download for Windows"}
              </button>
              {rel && <p className="dk-muted">Version {rel.version}{mb ? ` · ${mb}` : ""} · Windows 10 and 11</p>}
            </>
          )}
        {err && <p className="dk-err">{err}</p>}
      </div>

      <h2 className="dk-h">Installing</h2>
      <ol className="dk-steps">
        <li>Open the downloaded <b>setup</b> file.</li>
        <li>Windows may say <b>&ldquo;Windows protected your PC&rdquo;</b> (the app isn&apos;t signed with a paid certificate yet). Click <b>More info</b>, then <b>Run anyway</b>.</li>
        <li>Log in, then choose two folders: where your new music lands (your Downloads, say) and where the tidy library should go.</li>
        <li>Tick <b>Start with Windows</b> if you want it watching all the time. Closing the window keeps it running in the tray.</li>
      </ol>

      <h2 className="dk-h">Good to know</h2>
      <ul className="dk-steps">
        <li>Your originals are never changed. Tidied copies go into a &ldquo;Static-Cuts&rdquo; folder inside your library folder, with a list of what changed.</li>
        <li>Your music never leaves your computer. Only song details are looked up on Static-Cuts.</li>
        <li>The app can only read the folder it watches and only write inside your library folder.</li>
        <li>It never downloads music. It only tidies files you already have.</li>
      </ul>
    </div>
  );
}
