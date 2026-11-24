"use client";

// The "Run NIX on this PC" switch on /nix. In the desktop app: turn it on,
// pick the model, see what it's doing. On the website: how to get it.

import { useEffect, useState } from "react";
import Link from "next/link";
import { inDesktopApp } from "../local/desktop";
import { nixChoose, nixRefresh, nixState, nixTurnOn, subscribe, SUGGESTED_MODEL, type NixState } from "./worker";

export default function NixPanel() {
  const [s, setS] = useState<NixState>(nixState());
  const [desk, setDesk] = useState(false);
  useEffect(() => { setDesk(inDesktopApp()); setS(nixState()); return subscribe(setS); }, []);

  if (!desk) {
    return (
      <section className="cr-box">
        <div className="section-label">Run NIX on this PC</div>
        <div className="comment-meta">
          NIX&apos;s AI work can run free on your own computer instead of Claude. Open this page in the{" "}
          <Link href="/desktop" className="text-link">Static-Cuts desktop app</Link> (Windows) to switch it on. Owner and admins only.
        </div>
      </section>
    );
  }

  const st = s.status;
  const models = st?.models ?? [];
  return (
    <section className="cr-box">
      <div className="section-label">Run NIX on this PC</div>
      <label className="nix-switch">
        <input type="checkbox" checked={s.on} disabled={!s.allowed || st?.appTooOld} onChange={(e) => nixTurnOn(e.target.checked)} />
        <span>
          <b>Run NIX on {st?.pc ?? "this PC"}</b>: NIX&apos;s AI work (review notes, suggestions, sub-version checks, blurbs) runs here on
          your own model, for free, instead of Claude. It keeps going on any page and in the tray.
        </span>
      </label>
      <p className="comment-meta nix-status">
        {!s.allowed ? "Only the owner and admins can run NIX."
          : !st ? "Looking for Ollama…"
          : st.appTooOld ? <>This needs a newer version of the app. <Link href="/desktop" className="text-link">Download it</Link> and install it over the top (no need to uninstall).</>
          : !st.ollama ? <>Ollama isn&apos;t running. Install it from <a className="text-link" href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">ollama.com/download</a>, then in PowerShell run <code>ollama pull {SUGGESTED_MODEL}</code> (about 5 GB). <button className="inline-link-btn" onClick={nixRefresh}>Check again</button></>
          : models.length === 0 ? <>Ollama is running but has no models yet. In PowerShell run <code>ollama pull {SUGGESTED_MODEL}</code> (about 5 GB). <button className="inline-link-btn" onClick={nixRefresh}>Check again</button></>
          : !s.on ? <>Ready: Ollama is running with {models.length} model{models.length === 1 ? "" : "s"}. Tick the box to start.</>
          : s.doing ? <>Working on a {s.doing} job with {s.model}…</>
          : <>On, using {s.model}. Waiting for work{s.done ? ` (${s.done} job${s.done === 1 ? "" : "s"} done since the app opened)` : ""}.</>}
      </p>
      {st?.ollama && models.length > 1 && (
        <label className="nix-model">
          <span>Model</span>
          <select value={s.model ?? ""} onChange={(e) => nixChoose(e.target.value)}>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      )}
      {s.err && <p className="comment-meta nix-err">{s.err}</p>}
    </section>
  );
}
