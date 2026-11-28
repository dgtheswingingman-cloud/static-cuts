import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";

// The page itself runs in the browser; this gives it its own title and main
// address (see lib/seo.ts).
export const metadata: Metadata = pageMeta("/help", "Help wanted", "Small jobs anyone can do to improve the archive: check links, fill in missing info, date leaks.");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
