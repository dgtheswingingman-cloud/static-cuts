import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";

// The page itself runs in the browser; this gives it its own title and main
// address (see lib/seo.ts).
export const metadata: Metadata = pageMeta("/search", "Search", "Search every artist, song, leak and release in the Static-Cuts// archive.");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
