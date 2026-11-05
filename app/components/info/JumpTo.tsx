"use client";

// Phones: a "Jump to…" menu for the sections of an info page.

export default function JumpTo({ sections }: { sections: [string, string][] }) {
  return (
    <select className="sr-select if-jump" defaultValue="" aria-label="Jump to a section"
      onChange={(e) => { const id = e.target.value; if (id) document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); e.target.value = ""; }}>
      <option value="" disabled>Jump to…</option>
      {sections.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select>
  );
}
