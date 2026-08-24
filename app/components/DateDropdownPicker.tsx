"use client";

import { useEffect, useState } from "react";

// Shared Day/Month/Year date picker -- replaces the browser's native
// <input type="date"> calendar popup, which looks and feels inconsistent
// with the site's design. Composes to/from the same "YYYY-MM-DD" string
// the rest of the app already expects, so nothing downstream needs to
// change -- just how the value gets entered.
//
// Keeps its own local day/month/year state rather than deriving purely
// from the parent's value -- a parent value only exists once all three
// are picked, so a component with no memory of its own would reset every
// partial selection back to blank the instant you picked just one part.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function DateDropdownPicker({
  value,
  onChange,
  idPrefix,
}: {
  value: string;
  onChange: (value: string) => void;
  idPrefix: string;
}) {
  const [y, setY] = useState("");
  const [m, setM] = useState("");
  const [d, setD] = useState("");

  // Only resync from the parent when it hands us a genuinely different
  // value from outside (e.g. opening an edit form pre-filled with an
  // existing date) -- not on every render.
  useEffect(() => {
    if (value) {
      const [vy, vm, vd] = value.split("-");
      setY(vy ?? "");
      setM(vm ?? "");
      setD(vd ?? "");
    } else {
      setY("");
      setM("");
      setD("");
    }
  }, [value]);

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 1979 + 2 }, (_, i) => String(currentYear + 1 - i));
  const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));

  function update(part: "y" | "m" | "d", newVal: string) {
    const ny = part === "y" ? newVal : y;
    const nm = part === "m" ? newVal : m;
    const nd = part === "d" ? newVal : d;
    setY(ny);
    setM(nm);
    setD(nd);
    // Only compose a real date once all three are picked -- an
    // incomplete date isn't a valid value for the underlying date column.
    // The local state above still keeps whatever's been picked so far
    // visible, even while incomplete.
    onChange(ny && nm && nd ? `${ny}-${nm}-${nd}` : "");
  }

  return (
    <div style={{ display: "flex", gap: 4, flex: 2 }}>
      <select
        className="search-input"
        style={{ flex: 1 }}
        id={`${idPrefix}-day`}
        name={`${idPrefix}-day`}
        aria-label="Day"
        value={d}
        onChange={(e) => update("d", e.target.value)}
      >
        <option value="">Day</option>
        {days.map((dd) => (
          <option key={dd} value={dd}>{parseInt(dd, 10)}</option>
        ))}
      </select>
      <select
        className="search-input"
        style={{ flex: 1.4 }}
        id={`${idPrefix}-month`}
        name={`${idPrefix}-month`}
        aria-label="Month"
        value={m}
        onChange={(e) => update("m", e.target.value)}
      >
        <option value="">Month</option>
        {MONTHS.map((name, i) => (
          <option key={name} value={String(i + 1).padStart(2, "0")}>{name}</option>
        ))}
      </select>
      <select
        className="search-input"
        style={{ flex: 1 }}
        id={`${idPrefix}-year`}
        name={`${idPrefix}-year`}
        aria-label="Year"
        value={y}
        onChange={(e) => update("y", e.target.value)}
      >
        <option value="">Year</option>
        {years.map((yy) => (
          <option key={yy} value={yy}>{yy}</option>
        ))}
      </select>
    </div>
  );
}
