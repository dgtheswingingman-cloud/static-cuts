import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";

// The page itself runs in the browser; this gives it its own title and main
// address (see lib/seo.ts).
export const metadata: Metadata = pageMeta("/on-this-day", "On this day", "Every release, leak and anniversary for a day in music history.");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
