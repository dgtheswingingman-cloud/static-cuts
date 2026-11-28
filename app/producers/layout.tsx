import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";

// The page itself runs in the browser; this gives it its own title and main
// address (see lib/seo.ts).
export const metadata: Metadata = pageMeta("/producers", "Producers", "Everyone credited with producing songs in the archive, and what they've made.");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
