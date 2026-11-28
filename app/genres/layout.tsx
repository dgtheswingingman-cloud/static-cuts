import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";

// The page itself runs in the browser; this gives it its own title and main
// address (see lib/seo.ts).
export const metadata: Metadata = pageMeta("/genres", "Genres", "Every genre in the archive and the artists in it.");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
