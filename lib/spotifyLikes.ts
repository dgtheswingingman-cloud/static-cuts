// Collect → Liked Songs: when you collect a song that's on Spotify, it's also
// saved to your Liked Songs. One way only (un-collecting doesn't remove it).
//
// Uses Spotify's sign-in for browser apps (PKCE, no secret), like playlist
// export. The connection is kept in this browser (it can renew itself, so you
// connect once per device). Each save is one request from your own account.

import { SPOTIFY_CLIENT_ID, trackUri } from "./spotifyExport";

const STORE = "sc-spotify-likes";
const PENDING = "sc-spotify-likes-pending";

type Saved = { access: string; refresh: string; expires: number };

function read(): Saved | null {
  try { return JSON.parse(localStorage.getItem(STORE) ?? "null"); } catch { return null; }
}
function write(s: Saved | null) {
  try { if (s) localStorage.setItem(STORE, JSON.stringify(s)); else localStorage.removeItem(STORE); } catch { /* fine */ }
}

export function likesConnected() {
  return !!read()?.refresh;
}
export function disconnectLikes() {
  write(null);
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
const redirectUri = () => `${window.location.origin}/spotify-callback`;

// Is this callback ours (rather than a playlist export)?
export function isLikesCallback(state: string | null) {
  try {
    const p = JSON.parse(sessionStorage.getItem(PENDING) ?? "null");
    return !!p && p.state === state;
  } catch { return false; }
}

export async function connectLikes() {
  const verifier = randomString(64);
  const state = randomString(16);
  sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID, response_type: "code", redirect_uri: redirectUri(),
    code_challenge_method: "S256", code_challenge: await challenge(verifier),
    scope: "user-library-modify", state,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID, ...body }),
  });
  const tok = await res.json().catch(() => null);
  if (!res.ok || !tok?.access_token) throw new Error("Spotify sign-in didn't work. Try connecting again.");
  return tok as { access_token: string; refresh_token?: string; expires_in?: number };
}

export async function finishConnectLikes(code: string, state: string | null) {
  const p = JSON.parse(sessionStorage.getItem(PENDING) ?? "null") as { verifier: string; state: string } | null;
  if (!p || p.state !== state) throw new Error("That sign-in didn't match. Try connecting again.");
  sessionStorage.removeItem(PENDING);
  const tok = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: p.verifier });
  write({ access: tok.access_token, refresh: tok.refresh_token ?? "", expires: Date.now() + (tok.expires_in ?? 3600) * 1000 });
}

async function token(): Promise<string | null> {
  const s = read();
  if (!s?.refresh) return null;
  if (s.expires > Date.now() + 60_000) return s.access;
  try {
    const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refresh });
    write({ access: tok.access_token, refresh: tok.refresh_token ?? s.refresh, expires: Date.now() + (tok.expires_in ?? 3600) * 1000 });
    return tok.access_token;
  } catch {
    write(null); // connection no longer valid: connect again in Settings
    return null;
  }
}

// Save one song (by its Spotify link) to Liked Songs. Quietly does nothing
// when not connected or the song isn't on Spotify. Returns whether it saved.
export async function likeOnSpotify(url: string | null | undefined): Promise<boolean> {
  const uri = trackUri(url);
  if (!uri || !likesConnected()) return false;
  const t = await token();
  if (!t) return false;
  // Spotify's 2026 "save to library" endpoint; the older one as a fallback.
  let res = await fetch(`https://api.spotify.com/v1/me/library?uris=${encodeURIComponent(uri)}`, {
    method: "PUT", headers: { Authorization: `Bearer ${t}` },
  });
  if (res.status === 404 || res.status === 400) {
    res = await fetch(`https://api.spotify.com/v1/me/tracks?ids=${uri.split(":")[2]}`, {
      method: "PUT", headers: { Authorization: `Bearer ${t}` },
    });
  }
  return res.ok;
}
