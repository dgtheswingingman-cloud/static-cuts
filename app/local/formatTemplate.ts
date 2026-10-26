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
  // Remove empty optional wrappers from the TEMPLATE, not from song metadata.
  const withoutEmptyWrappers = template.replace(/\(\s*\{(artist|title|album|year|track)\}\s*\)|\[\s*\{(artist|title|album|year|track)\}\s*\]/g,
    (whole, parenKey: string | undefined, bracketKey: string | undefined) => {
      const key = parenKey ?? bracketKey;
      return key && values[key] ? whole : "";
    });

  // Clean only template separators and whitespace before restoring metadata.
  // A canonical title such as "- Intro", "Track -" or "A  B" must not be
  // silently rewritten by the filename layout renderer.
  // Valid templates cannot contain control characters, so temporary markers
  // cannot collide with user-entered template text.
  const replacements: string[] = [];
  const staged = withoutEmptyWrappers.replace(/\{(artist|title|album|year|track)\}/g, (_, key: string) => {
    const value = values[key] ?? "";
    if (!value) return "";
    const marker = "\u0000" + replacements.length + "\u0000";
    replacements.push(value);
    return marker;
  });
  return staged
    .replace(/^\s*[-–—]\s*|\s*[-–—]\s*$/g, "")
    .replace(/\s{2,}/g, " ").trim()
    .replace(/\u0000(\d+)\u0000/g, (_, index: string) => replacements[Number(index)]);
}

// Only '/' characters in the user-entered TEMPLATE create folder levels.
// Archive artist/album values may themselves contain '/' (e.g. "AC/DC").
// Split first, then interpolate each level so those values remain one segment
// for the existing safeName() sanitizer. Skip missing/empty folder levels.
export function formatFolderSegments(template: string, values: Record<string, string>): string[] {
  return template.split("/")
    .map((segment) => formatTemplate(segment, values))
    .filter((segment) => segment.trim().length > 0);
}

// Pick a collision-free export name without ever touching source files.
// Use the ACTUAL source extension, not a dot in a song title or folder name.
// Without this, two extensionless files can trap the export loop forever.
export function uniqueExportPath(path: string, used: ReadonlySet<string>, extension: string): string {
  if (!used.has(path.toLowerCase())) return path;
  const splitAt = path.lastIndexOf("/") + 1;
  const directory = path.slice(0, splitAt);
  const filename = path.slice(splitAt);
  const suffix = extension && filename.toLowerCase().endsWith(extension.toLowerCase())
    ? filename.slice(-extension.length) : "";
  const stem = filename.slice(0, filename.length - suffix.length);
  for (let n = 2; ; n++) {
    const candidate = `${directory}${stem} (${n})${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

// Preserve the source format. Renaming never transcodes audio, so an
// extensionless recording must not be disguised as an MP3 on export.
export function sourceExtension(name: string): string {
  return name.match(/\.[a-z0-9]{2,5}$/i)?.[0].toLowerCase() ?? "";
}

// Windows device names remain reserved even with extensions. Never change tags.
export function safeExportSegment(segment: string): string {
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
    ? "_" + segment : segment;
}


// Directory exports must never reuse yesterday's or an earlier run's files.
// The File System Access API has no atomic "create only if absent" operation;
// checking each name first prevents normal repeat-export overwrites.
export async function createUnusedExportDirectory(
  root: Pick<FileSystemDirectoryHandle, "getDirectoryHandle">,
  baseName: string,
): Promise<FileSystemDirectoryHandle> {
  for (let n = 1; n <= 10000; n++) {
    const name = n === 1 ? baseName : `${baseName} (${n})`;
    try {
      await root.getDirectoryHandle(name);
      // An existing directory must never be selected for a new export.
    } catch (error) {
      if (error instanceof DOMException && error.name === "TypeMismatchError") continue;
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
      return root.getDirectoryHandle(name, { create: true });
    }
  }
  throw new Error("Could not find an unused export folder name.");
}
