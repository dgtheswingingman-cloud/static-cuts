import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";

// The page itself runs in the browser; this gives it its own title and main
// address (see lib/seo.ts).
export const metadata: Metadata = pageMeta("/takedown", "Takedown request", "Ask for a song or page to be taken down.");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
