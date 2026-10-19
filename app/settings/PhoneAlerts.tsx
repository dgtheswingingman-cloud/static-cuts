"use client";

// Phone alerts: your notifications (release day, followed artists, replies)
// also pop up on this device, even with the site closed. Per device: turn
// it on on each phone or computer you want them on. On iPhone it works once
// the site is added to the home screen (Share → Add to Home Screen).

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Public half of the signing key pair (the private half is only on the server).
const PUBLIC_KEY = "BMHBNRhHIsImjVkMlPM-TXbtvADXpnePEWGBDrWJuY-DSVFu-GRyGm8LxquPcqaxZZK03EsdLOEsf7vvvI3MSds";

export default function PhoneAlerts() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const ok = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    navigator.serviceWorker.getRegistration().then((reg) => reg?.pushManager.getSubscription()).then((sub) => setOn(!!sub)).catch(() => {});
  }, []);

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("Your browser blocked notifications for this site. Allow them in the browser's site settings, then try again.");
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: PUBLIC_KEY });
      const j = sub.toJSON();
      const { error } = await supabase.rpc("rpc_push_subscribe", { p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth });
      if (error) throw new Error(error.message);
      setOn(true);
      setMessage("Done. New notifications will pop up on this device.");
    } catch (e: any) {
      setMessage(`Couldn't turn them on: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    try {
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      if (sub) {
        await supabase.rpc("rpc_push_unsubscribe", { p_endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setOn(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 0" }}>
        <span style={{ fontFamily: "var(--font-inter)", fontSize: "0.9rem" }}>Phone alerts on this device</span>
        {supported === false ? (
          <span className="comment-meta">not available in this browser</span>
        ) : (
          <button className={`tab ${on ? "active" : ""}`} disabled={busy || supported === null} onClick={on ? turnOff : turnOn}>
            {busy ? "…" : on ? "on" : "off"}
          </button>
        )}
      </div>
      <div className="comment-meta">
        Your notifications also pop up here, even with the site closed. Turn it on for each device you want them on.
        On iPhone, add the site to your home screen first (Share → Add to Home Screen) and turn it on from there.
      </div>
      {message && <div className="comment-meta" style={{ marginTop: 6 }}>{message}</div>}
    </div>
  );
}
