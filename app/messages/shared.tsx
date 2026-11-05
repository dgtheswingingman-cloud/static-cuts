"use client";

// Bits shared by the messages pages.

export type Chat = {
  id: string; name: string | null; avatar_url: string | null;
  last: string | null; last_at: string | null; last_mine: boolean | null; unread: number; friend: boolean;
};

export function Avatar({ url, size = 36 }: { url: string | null; size?: number }) {
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt="" className="ms-avatar" style={{ width: size, height: size }} />
    : <span className="ms-avatar ms-avatar-blank" style={{ width: size, height: size }} />;
}

export function when(at: string) {
  const d = new Date(at);
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// "2h ago", "Yesterday", "3d ago", then a date.
export function ago(at: string) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// "Today 14:02", "Yesterday 09:10", "Mon 3 Nov 18:40": shown above a run of
// messages when there's been a gap.
export function stamp(at: string) {
  const d = new Date(at), now = new Date();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= start) return `Today ${time}`;
  if (d.getTime() >= start - 86400000) return `Yesterday ${time}`;
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}
