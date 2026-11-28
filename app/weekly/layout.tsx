import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";

// The page itself runs in the browser; this gives it its own title and main
// address (see lib/seo.ts).
export const metadata: Metadata = pageMeta("/weekly", "This week", "What leaked and what came out this week, and how much was added to the archive.");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
