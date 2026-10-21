"use client";

// Every anniversary for a day, with buttons to step through the calendar.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { AnniversaryRow, type Anniversary } from "../OnThisDay";

function todayLondon() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}
function shift(day: string, by: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : todayLondon();
  const [items, setItems] = useState<Anniversary[] | null>(null);

  useEffect(() => {
    setItems(null);
    supabase.rpc("rpc_on_this_day", { p_day: day, p_limit: 200 }).then(({ data }) => setItems((data as Anniversary[]) ?? []));
  }, [day]);

  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  const go = (d: string) => router.replace(d === todayLondon() ? "/on-this-day" : `/on-this-day?date=${d}`, { scroll: false });

  return (
    <div className="wrap">
      <h1 className="detail-name page-title">On {label}</h1>
      <div className="detail-meta">Songs released or leaked on {label} in past years.</div>
      <div className="tabs">
        <button className="tab" onClick={() => go(shift(day, -1))}>← previous day</button>
        {day !== todayLondon() && <button className="tab" onClick={() => go(todayLondon())}>today</button>}
        <button className="tab" onClick={() => go(shift(day, 1))}>next day →</button>
      </div>
      {!items && <div className="empty-state">loading…</div>}
      {items && items.length === 0 && (
        <div className="empty-state">Nothing dated {label} yet. Release and leak dates fill in as songs get added and corrected.</div>
      )}
      {items?.map((a) => <AnniversaryRow key={a.kind + a.track_id} a={a} />)}
    </div>
  );
}

export default function OnThisDayPage() {
  return (
    <Suspense fallback={<div className="wrap"><div className="empty-state">loading…</div></div>}>
      <Inner />
    </Suspense>
  );
}
