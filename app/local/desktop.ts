// Local Cuts in the Static-Cuts desktop app (desktop/ in this repo).
//
// The app opens this page in its own window and adds what a browser can't
// do: remember two folders (where your music lands, and where the tidy
// library goes), watch the first one, and read / write files there. The
// app itself only lets this page read inside the watched folder and write
// inside the library folder; nothing else on the computer.
//
// On the website none of this exists (no window.__TAURI__) and the page works
// as before.

type Invoke = (cmd: string, args?: unknown, options?: { headers?: Record<string, string> }) => Promise<unknown>;
type Listen = (event: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;
type TauriGlobal = { core: { invoke: Invoke }; event: { listen: Listen } };

function tauri(): TauriGlobal | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__) ?? null;
}

export const inDesktopApp = () => tauri() !== null;

export type Folders = { watch: string | null; library: string | null };

// Files are named by their path inside the watched folder ("Carti/x.mp3").
export const desktop = {
  folders: async (): Promise<Folders> => (await tauri()!.core.invoke("get_folders")) as Folders,
  choose: async (which: "watch" | "library"): Promise<Folders> => (await tauri()!.core.invoke("choose_folder", { which })) as Folders,
  // Every song already in the watched folder.
  list: async (): Promise<string[]> => (await tauri()!.core.invoke("list_watched")) as string[],
  // One song from the watched folder, as a File the page can read.
  file: async (rel: string): Promise<File> => {
    const bytes = (await tauri()!.core.invoke("read_watched", { rel })) as ArrayBuffer;
    return new File([bytes], rel.split("/").pop() || rel);
  },
  // New songs that have finished arriving (the app waits until a file has
  // stopped growing, so half-downloaded files aren't picked up).
  onNewFiles: (cb: (rels: string[]) => void) =>
    tauri()!.event.listen("local-cuts://new-files", (e) => cb((e.payload as string[]) ?? [])),
  // Start with Windows (quietly, in the tray).
  autostart: async (): Promise<boolean> => (await tauri()!.core.invoke("get_autostart")) as boolean,
  setAutostart: async (on: boolean): Promise<boolean> => (await tauri()!.core.invoke("set_autostart", { on })) as boolean,
  // A Windows notification after a batch ("3 new songs tidied…").
  tidied: (count: number, failed: number) => tauri()!.core.invoke("tidied", { count, failed }).catch(() => {}),
  // A newer app version already downloaded (its version), or null. Older
  // installs don't have these commands; they just answer null.
  updateReady: async (): Promise<string | null> => {
    try { return ((await tauri()!.core.invoke("update_status")) as string | null) ?? null; } catch { return null; }
  },
  onUpdateReady: (cb: (version: string) => void) =>
    tauri()!.event.listen("local-cuts://update-ready", (e) => cb(String(e.payload ?? ""))),
  installUpdate: () => tauri()!.core.invoke("install_update"),
  // NIX on this PC (owner): the local Ollama's models, and one answer from it.
  // Older installs don't have these commands: appTooOld.
  aiStatus: async (): Promise<AiStatus> => {
    try { return (await tauri()!.core.invoke("ai_status")) as AiStatus; }
    catch { return { ollama: false, models: [], pc: "this PC", appTooOld: true }; }
  },
  aiGenerate: async (model: string, prompt: string, json: boolean): Promise<string> =>
    (await tauri()!.core.invoke("ai_generate", { model, prompt, json })) as string,
};

export type AiStatus = { ollama: boolean; models: string[]; pc: string; appTooOld?: boolean };

// Writes the tidy library into the library folder ("Static-Cuts/Artist/Album/x.mp3").
export class LibraryWriter {
  async add(path: string, blob: Blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await tauri()!.core.invoke("write_library", bytes, { headers: { "x-path": encodeURIComponent(path) } });
  }
}

// Songs already tidied on this computer, so they aren't done twice
// ("path|size"). Kept in this window's storage.
const DONE_KEY = "local_desktop_done";
export function doneSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}
export function markDone(keys: string[]) {
  try {
    const s = doneSet();
    keys.forEach((k) => s.add(k));
    localStorage.setItem(DONE_KEY, JSON.stringify([...s].slice(-50000)));
  } catch { /* fine */ }
}
