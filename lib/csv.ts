// Spreadsheet (CSV) downloads: Excel / Google Sheets friendly (UTF-8 with BOM).

export function csv(rows: (string | number | null | undefined)[][]) {
  return rows.map((r) => r.map((c) => {
    const v = c === null || c === undefined ? "" : String(c);
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(",")).join("\r\n");
}

export function saveCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv(rows)], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const fileSafe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "export";
