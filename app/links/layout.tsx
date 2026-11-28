import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";

// The page itself runs in the browser; this gives it its own title and main
// address (see lib/seo.ts).
export const metadata: Metadata = pageMeta("/links", "Links", "Song of the day, album of the week, on this day and the main ways into Static-Cuts//.");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
