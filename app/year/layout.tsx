import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";

// The page itself runs in the browser; this gives it its own title and main
// address (see lib/seo.ts).
export const metadata: Metadata = pageMeta("/year", "Your year", "Your year on Static-Cuts//: what you collected, your top artists and rarest finds.", { noindex: true });

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
