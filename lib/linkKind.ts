// What a song's main link actually is. Community trackers (and so the
// archive) put the proof in the link column when there's no audio: a tweet,
// a screenshot, a post. Those shouldn't show as "Listen".

export type LinkKind = { kind: "listen" | "proof"; name: string; label: string };

const host = (u: string) => { try { return new URL(u).hostname.replace(/^(www|m|mobile)\./, "").toLowerCase(); } catch { return ""; } };

export function linkKind(url: string | null | undefined): LinkKind | null {
  if (!url) return null;
  const h = host(url);
  if (!h) return null;
  const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ""; } })();
  if (/\.(png|jpe?g|gif|webp|heic|avif)$/.test(path) || /(^|\.)(imgur\.com|imgur\.gg|ibb\.co|postimg\.cc|prnt\.sc|i\.redd\.it|gyazo\.com)$/.test(h))
    return { kind: "proof", name: "Picture", label: "See the picture" };
  if (/(^|\.)(x\.com|twitter\.com|fxtwitter\.com|vxtwitter\.com)$/.test(h)) return { kind: "proof", name: "Tweet", label: "See the tweet" };
  if (/(^|\.)instagram\.com$/.test(h)) return { kind: "proof", name: "Instagram", label: "See the post" };
  if (/(^|\.)(reddit\.com|redd\.it)$/.test(h)) return { kind: "proof", name: "Reddit", label: "See the post" };
  if (/(^|\.)(discord\.com|discord\.gg)$/.test(h)) return { kind: "proof", name: "Discord", label: "See the message" };
  if (/(^|\.)docs\.google\.com$/.test(h)) return { kind: "proof", name: "Tracker", label: "See the tracker" };
  if (h === "open.spotify.com" || h.endsWith("spotify.com") || h === "spotify.link") return { kind: "listen", name: "Spotify", label: "Spotify" };
  if (h.endsWith("soundcloud.com")) return { kind: "listen", name: "SoundCloud", label: "SoundCloud" };
  if (h === "youtu.be" || h.endsWith("youtube.com")) return { kind: "listen", name: "YouTube", label: "YouTube" };
  if (h.endsWith("music.apple.com")) return { kind: "listen", name: "Apple Music", label: "Apple Music" };
  if (h.endsWith("deezer.com") || h === "deezer.page.link") return { kind: "listen", name: "Deezer", label: "Deezer" };
  if (h.endsWith("bandcamp.com")) return { kind: "listen", name: "Bandcamp", label: "Bandcamp" };
  if (h.endsWith("tidal.com")) return { kind: "listen", name: "TIDAL", label: "TIDAL" };
  if (h.endsWith("audiomack.com")) return { kind: "listen", name: "Audiomack", label: "Audiomack" };
  if (h.endsWith("tiktok.com")) return { kind: "listen", name: "TikTok", label: "TikTok" };
  return { kind: "listen", name: h.replace(/^www\./, ""), label: h.replace(/^www\./, "") };
}

export const isListen = (url: string | null | undefined) => linkKind(url)?.kind === "listen";
