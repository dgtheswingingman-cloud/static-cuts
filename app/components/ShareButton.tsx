"use client";

// One share button. On phones it opens the share sheet with a story-sized
// picture (1080x1920) and the link, so Instagram / TikTok stories get the
// right shape and chats still get the link. On computers it copies the link.
//
// The picture is made ahead of time (the share sheet only opens straight
// from a tap, so there's no time to draw it after the tap).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { drawStory, type Story } from "./story";

type Props = {
  title: string;
  path?: string;
  label?: ReactNode;
  className?: string;
  ariaLabel?: string;
  story?: () => Story | Promise<Story>;
  storyKey?: string; // change this when the story's contents change
  fileName?: string;
};

type Nav = Navigator & { canShare?: (d: ShareData) => boolean };

export default function ShareButton({ title, path, label = "share", className = "tab", ariaLabel, story, storyKey, fileName = "static-cuts" }: Props) {
  const [copied, setCopied] = useState(false);
  const file = useRef<File | null>(null);
  const storyFn = useRef(story);
  storyFn.current = story;

  useEffect(() => {
    file.current = null;
    const nav = navigator as Nav;
    if (!storyFn.current || !nav.canShare) return;
    let gone = false;
    (async () => {
      try {
        const blob = await drawStory(await storyFn.current!());
        if (!blob || gone) return;
        const f = new File([blob], `${fileName}.png`, { type: "image/png" });
        if (nav.canShare?.({ files: [f] })) file.current = f;
      } catch { /* link only */ }
    })();
    return () => { gone = true; };
  }, [storyKey, fileName]);

  async function share() {
    const url = window.location.origin + (path ?? window.location.pathname);
    const nav = navigator as Nav;
    if (file.current) {
      try {
        await nav.share({ files: [file.current], title, text: `${title}\n${url}` });
        return;
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return; // closed the sheet
      }
    }
    if (nav.share) {
      nav.share({ title, url }).catch(() => {});
      return;
    }
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); });
  }
  return <button className={className} aria-label={ariaLabel} onClick={share}>{copied ? "link copied" : label}</button>;
}
