import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";

// The page itself runs in the browser; this gives it its own title and main
// address (see lib/seo.ts).
export const metadata: Metadata = pageMeta("/collabs", "Collab map", "Who has worked with who: every collaboration between artists in the archive.");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
