import type { Metadata } from "next";

// Title, description and "main address" for a public page. The main address
// (canonical) tells search engines that /search?q=carti, /help?artist=… and
// the bare /search are one page, not hundreds of copies. Google listed 215
// "duplicate without canonical" pages before these were added.
export function pageMeta(path: string, title: string, description: string, opts: { noindex?: boolean } = {}): Metadata {
  const full = `${title} · Static-Cuts//`;
  return {
    title: full,
    description,
    alternates: { canonical: path },
    openGraph: { title: full, description, url: path },
    ...(opts.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}
