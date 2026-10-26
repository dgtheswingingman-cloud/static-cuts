// Local Cuts export templates: editable filename/folder layouts, never audio metadata.
const FIELDS = new Set(["artist", "title", "album", "year", "track"]);

export function templateError(template: string, allowEmpty = false): string | null {
  if (template.length > 160) return "Template is too long (maximum 160 characters).";
  if (!allowEmpty && !template.trim()) return "Enter a filename template.";
  if (/[\u0000-\u001f]/.test(template)) return "Template contains a control character.";
  const tokens = template.match(/\{[^{}]*\}/g) ?? [];
  for (const token of tokens) {
    if (!FIELDS.has(token.slice(1, -1))) return "Unknown placeholder " + token + ". Use artist, title, album, year or track.";
  }
  if (/[{}]/.test(template.replace(/\{[^{}]*\}/g, ""))) return "Unmatched brace in template. Use {title}, {artist}, {album}, {year} or {track}.";
  return null;
}

export function formatTemplate(template: string, values: Record<string, string>): string {
  // Remove empty optional wrappers from the TEMPLATE, not from canonical
  // song titles (which may legitimately contain literal "()" or "[]").
  return template.replace(/\(\s*\{(artist|title|album|year|track)\}\s*\)|\[\s*\{(artist|title|album|year|track)\}\s*\]/g,
    (whole, parenKey: string | undefined, bracketKey: string | undefined) => {
      const key = parenKey ?? bracketKey;
      return key && values[key] ? whole : "";
    })
    .replace(/\{(artist|title|album|year|track)\}/g, (_, key: string) => values[key] ?? "")
    .replace(/^\s*[-–—]\s*|\s*[-–—]\s*$/g, "")
    .replace(/\s{2,}/g, " ").trim();
}
