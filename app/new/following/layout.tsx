import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";

// The page itself runs in the browser; this gives it its own title and main
// address (see lib/seo.ts).
export const metadata: Metadata = pageMeta("/new/following", "New from artists you follow", "What's new from the artists you follow.", { noindex: true });

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
