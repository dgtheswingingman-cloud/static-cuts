"use client";

// The two plans and their buttons. "Go monthly / yearly" opens Stripe's
// checkout; "Manage or cancel" opens Stripe's own page for changing card,
// plan or cancelling. Coming back from checkout (?done=1) re-reads the
// subscription straight away, in case Stripe's message hasn't landed yet.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "../AuthProvider";
import { usePremium } from "../usePremium";

type Price = { id: string; amount: number; currency: string } | null;
const money = (p: Price) => p ? new Intl.NumberFormat("en-GB", { style: "currency", currency: p.currency.toUpperCase(), minimumFractionDigits: p.amount % 100 ? 2 : 0 }).format(p.amount / 100) : "…";
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

async function billing(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("billing", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  return data as Record<string, unknown>;
}

export default function Plans() {
  const { user, loading } = useAuth();
  const { premium, until, stripe, customer, reload } = usePremium();
  const [prices, setPrices] = useState<{ month: Price; year: Price; test?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);

  useEffect(() => {
    billing({ action: "prices" }).then((d) => setPrices(d as typeof prices)).catch(() => setPrices({ month: null, year: null }));
  }, []);

  // Back from checkout: sync now, then tidy the address.
  useEffect(() => {
    if (loading || !user || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("done") !== "1") return;
    setThanks(true);
    window.history.replaceState(null, "", "/premium");
    billing({ action: "sync" }).catch(() => null).finally(reload);
  }, [loading, user, reload]);

  async function go(action: "checkout" | "portal", plan?: "month" | "year") {
    setErr(null); setBusy(plan ?? action);
    try {
      const d = await billing({ action, plan, origin: window.location.origin });
      if (typeof d.url === "string") { window.location.href = d.url; return; }
      throw new Error("Stripe didn't send a link back.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e)); setBusy(null);
    }
  }

  const saving = prices?.month && prices?.year ? Math.round(100 - (prices.year.amount / (prices.month.amount * 12)) * 100) : 0;
  const paying = !!stripe && ["active", "trialing", "past_due"].includes(stripe);

  return (
    <div className="pm">
      {prices?.test && <p className="if-p pm-test">Test mode: no real money moves. Pay with card 4242 4242 4242 4242, any future date, any CVC.</p>}
      {thanks && premium && <p className="if-p pm-ok"><span>//</span> You&apos;re premium. Thank you for keeping the archive going.</p>}
      {thanks && premium === false && <p className="if-p if-dim">Payment&apos;s going through. This page updates in a moment… <button className="text-link" onClick={() => { billing({ action: "sync" }).catch(() => null).finally(reload); }}>check again</button></p>}

      {premium && (
        <div className="pm-status">
          <strong>◆ You have premium</strong>
          <small>
            {paying ? (stripe === "past_due" ? "Your last payment didn't go through. Stripe will try again; update your card to keep premium."
              : until ? `Renews or ends around ${day(until)}.` : "")
              : until ? `Until ${day(until)}.` : "No end date."}
          </small>
          {customer && <button className="tab active pm-btn" disabled={!!busy} onClick={() => go("portal")}>{busy === "portal" ? "Opening…" : "Manage or cancel"}</button>}
        </div>
      )}

      {!paying && (
        <div className="pm-plans">
          {([["month", "Monthly", "a month"], ["year", "Yearly", "a year"]] as const).map(([plan, name, per]) => (
            <div key={plan} className={`pm-plan${plan === "year" ? " best" : ""}`}>
              <div className="pm-top"><b>{name}</b>{plan === "year" && saving > 0 && <span className="pm-tag">SAVE {saving}%</span>}</div>
              <div className="pm-price">{money(prices?.[plan] ?? null)}<small> {per}</small></div>
              {!user && !loading
                ? <Link className="tab active pm-btn" href="/login?next=/premium">Log in to go premium</Link>
                : <button className="tab active pm-btn" disabled={!!busy || !prices?.[plan]} onClick={() => go("checkout", plan)}>
                    {busy === plan ? "Opening checkout…" : premium ? `Pay ${name.toLowerCase()}` : `Go ${name.toLowerCase()}`}
                  </button>}
            </div>
          ))}
        </div>
      )}
      {!paying && customer && !premium && (
        <p className="if-p if-dim">Paid before? <button className="text-link" disabled={!!busy} onClick={() => go("portal")}>See your past payments</button></p>
      )}
      {err && <p className="if-p pm-err">{err}</p>}
    </div>
  );
}
