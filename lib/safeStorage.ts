// Browser storage that never throws. Some browsers (storage blocked, some
// private modes, in-app browsers) throw on any use of localStorage or
// sessionStorage; a throw on a page that every visit loads would break the
// whole site for that person. Reads come back null and writes are skipped.

function make(kind: "localStorage" | "sessionStorage") {
  const s = (): Storage | null => {
    try { return typeof window === "undefined" ? null : window[kind]; } catch { return null; }
  };
  return {
    get(key: string): string | null { try { return s()?.getItem(key) ?? null; } catch { return null; } },
    set(key: string, value: string) { try { s()?.setItem(key, value); } catch { /* not available */ } },
    remove(key: string) { try { s()?.removeItem(key); } catch { /* not available */ } },
  };
}

export const local = make("localStorage");
export const session = make("sessionStorage");
