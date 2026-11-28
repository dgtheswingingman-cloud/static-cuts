import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";

// The page itself runs in the browser; this gives it its own title and main
// address (see lib/seo.ts).
export const metadata: Metadata = pageMeta("/lists", "Lists", "Lists people have put together: favourite leaks, best features and where to start with an artist.");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
