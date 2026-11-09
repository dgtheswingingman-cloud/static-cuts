"use client";

// Artist page (Overview): shows, tours, festivals and merch drops that are
// coming up (merch from the last 30 days too). Each links to its source.
// Nothing shows without data.

import { useEffect, useState } from "react";
import "../../styles/coming-up.css";
import { supabase } from "@/lib/supabase";

type Item = {
  id: string; kind: "show" | "tour" | "festival" | "merch"; title: string; starts_on: string | null; ends_on: string | null;
  venue: string | null; city: string | null; country: string | null; url: string;
};
const KIND: Record<Item["kind"], string> = { show: "Show", tour: "Tour", festival: "Festival", merch: "Merch" };
const day = (d: string) => new Date(`${d}T12:00:00`);
const fmt = (d: string, withYear: boolean) =>
  day(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });

function when(i: Item) {
  if (!i.starts_on) return null;
  const y = day(i.starts_on).getFullYear() !== new Date().getFullYear();
  if (i.ends_on && i.ends_on !== i.starts_on) return `${fmt(i.starts_on, false)} – ${fmt(i.ends_on, y)}`;
  return fmt(i.starts_on, y);
}

export default function ComingUp({ artistId }: { artistId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    setItems(null);
    supabase.rpc("rpc_artist_announcements", { p_artist: artistId }).then(({ data }) => setItems((data as Item[] | null) ?? []));
  }, [artistId]);
  if (!items || items.length === 0) return null;
  const shown = all ? items : items.slice(0, 6);
  return (
    <section className="cu">
      <div className="sp-head">
        <h2>Coming up</h2>
        {items.length > 6 && <button onClick={() => setAll(!all)}>{all ? "Show less" : `All ${items.length} →`}</button>}
      </div>
      <ul className="cu-list">
        {shown.map((i) => (
          <li key={i.id} className={`cu-row cu-${i.kind}`}>
            <span className="cu-when">{when(i) ?? "Date TBA"}</span>
            <span className="cu-text">
              <span className="cu-title">{i.title}</span>
              <span className="cu-sub">
                <span className="cu-kind">{KIND[i.kind]}</span>
                {[i.venue, i.city, i.country].filter(Boolean).join(", ")}
              </span>
            </span>
            <a href={i.url} target="_blank" rel="noopener noreferrer" className="cu-link">Source ↗</a>
          </li>
        ))}
      </ul>
    </section>
  );
}
