import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";

// The page itself runs in the browser; this gives it its own title and main
// address (see lib/seo.ts).
export const metadata: Metadata = pageMeta("/new", "What's new", "Songs added and status changes in the archive, day by day and artist by artist.");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
