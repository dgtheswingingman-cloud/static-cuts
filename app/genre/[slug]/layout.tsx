import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";

// The page itself runs in the browser; this gives each genre its own title
// and main address (see lib/seo.ts).
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const name = decodeURIComponent(slug).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return pageMeta(`/genre/${slug}`, name, `${name} artists in the Static-Cuts// archive: every song, leak and release.`);
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
