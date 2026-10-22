"use client";

// Bits shared by the messages pages.

export type Chat = {
  id: string; name: string | null; avatar_url: string | null;
  last: string | null; last_at: string | null; last_mine: boolean | null; unread: number; friend: boolean;
};

export function Avatar({ url, size = 36 }: { url: string | null; size?: number }) {
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
    : <span style={{ width: size, height: size, borderRadius: "50%", background: "var(--surface2)", display: "inline-block", flexShrink: 0 }} />;
}

export function when(at: string) {
  const d = new Date(at);
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

