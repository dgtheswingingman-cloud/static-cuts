import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";

// The page itself runs in the browser; this gives it its own title and main
// address (see lib/seo.ts).
export const metadata: Metadata = pageMeta("/sources", "Sources", "The community spreadsheets the archive has imported, credited to their makers.");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
