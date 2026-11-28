import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";

// The page itself runs in the browser; this gives it its own title and main
// address (see lib/seo.ts).
export const metadata: Metadata = pageMeta("/desktop", "Desktop app", "The Static-Cuts// desktop app for Windows.");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
