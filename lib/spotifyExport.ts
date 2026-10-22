// Export songs to a new Spotify playlist in the listener's own Spotify
// account. Uses Spotify's sign-in for browser apps (PKCE): no secret, the
// token stays in this browser tab, and it's separate from signing in to
// Static Cuts. Only songs with a Spotify track link can go in a playlist.
// While our Spotify app is in development mode, only Spotify accounts added
// in its developer dashboard (a handful) can sign in here.
//
// Needs NEXT_PUBLIC_SPOTIFY_CLIENT_ID (the app's client ID, which isn't
// secret) and https://static-cuts.com/spotify-callback added as a redirect
// URI in the Spotify developer dashboard.

export const SPOTIFY_CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID ?? "";

export type PendingExport = { name: string; description: string; uris: string[]; back: string };

const KEY = "sc-spotify-export";

export function trackUri(url: string | null | undefined) {
  const id = url?.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})/)?.[1];
  return id ? `spotify:track:${id}` : null;
}

function randomString(n: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[b % 62]).join("");
}

async function challenge(verifier: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let bin = "";
  new Uint8Array(hash).forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function redirectUri() {
  return `${window.location.origin}/spotify-callback`;
}

// Step 1: remember what to export, then send the listener to Spotify.
export async function startSpotifyExport(pending: PendingExport) {
  const verifier = randomString(64);
  const state = randomString(16);
  sessionStorage.setItem(KEY, JSON.stringify({ pending, verifier, state }));
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: await challenge(verifier),
    scope: "playlist-modify-private",
    state,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function api(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (res.status === 429) throw new Error("Spotify is busy right now. Try again in a few minutes.");
  // Development mode: accounts not added in the Spotify dashboard get 403.
  if (res.status === 403) {
    throw new Error("Spotify won't let this account in yet. Spotify limits new sites to a few invited accounts, so ask us to add yours.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = new Error(body?.error?.message ?? `Spotify said no (${res.status}).`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

// Step 2 (on /spotify-callback): swap the code for a token and build the playlist.
export async function finishSpotifyExport(code: string, state: string | null) {
  const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as
    { pending: PendingExport; verifier: string; state: string } | null;
  if (!saved || saved.state !== state) throw new Error("That sign-in didn't match. Try exporting again.");
  sessionStorage.removeItem(KEY);

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID, grant_type: "authorization_code", code,
      redirect_uri: redirectUri(), code_verifier: saved.verifier,
    }),
  });
  const tok = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok || !tok?.access_token) throw new Error("Spotify sign-in didn't work. Try again.");
  const token = tok.access_token as string;

  // Spotify's 2026 changes: playlists are made with POST /me/playlists, and
  // songs are added at /playlists/{id}/items.
  const playlist = await api(token, "/me/playlists", {
    method: "POST",
    body: JSON.stringify({ name: saved.pending.name.slice(0, 100), description: saved.pending.description.slice(0, 300), public: false }),
  });
  const uris = [...new Set(saved.pending.uris)];
  for (let i = 0; i < uris.length; i += 100) {
    await api(token, `/playlists/${playlist.id}/items`, { method: "POST", body: JSON.stringify({ uris: uris.slice(i, i + 100) }) });
  }
  return { url: playlist.external_urls?.spotify as string, name: playlist.name as string, count: uris.length, back: saved.pending.back };
}
