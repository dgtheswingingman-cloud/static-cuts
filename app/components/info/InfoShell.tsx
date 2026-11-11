import "../../styles/info.css";
// The shared layout for the info pages (FAQ, How to listen, Sources, Privacy
// & terms, Request a takedown): a title with //, a line about the page, a
// contents list (down the side on computers, a "Jump to" menu on phones),
// the page's sections, and links to the other info pages at the bottom.

import type { ReactNode } from "react";
import Link from "next/link";
import JumpTo from "./JumpTo";

export const INFO_PAGES: [string, string][] = [
  ["/faq", "FAQ"],
  ["/listen", "How to listen"],
  ["/discord", "Discord bot"],
  ["/premium", "Premium"],
  ["/sources", "Sources"],
  ["/legal", "Privacy & terms"],
  ["/takedown", "Request a takedown"],
];

export default function InfoShell({ title, intro, here, sections, children }: {
  title: string; intro: ReactNode; here: string; sections?: [string, string][]; children: ReactNode;
}) {
  return (
    <div className="wrap if-page">
      <h1 className="ls-title if-title">{title}<span>//</span></h1>
      <p className="sb-lead if-intro">{intro}</p>
      <div className="if-layout">
        {sections && sections.length > 1 && (
          <aside className="if-side">
            <nav aria-label="On this page" className="if-toc">
              <span className="if-toc-h">On this page</span>
              {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
            </nav>
            <JumpTo sections={sections} />
          </aside>
        )}
        <div className="if-main">
          {children}
          <section className="nw-panel if-stuck">
            <h2 className="nw-h">Still stuck?<span>//</span></h2>
            <p>Check the other info pages:</p>
            <nav className="if-links">
              {INFO_PAGES.filter(([href]) => href !== here).map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
            </nav>
          </section>
        </div>
      </div>
    </div>
  );
}

// A boxed section with a heading, for the info pages.
export function InfoSection({ id, title, children, className }: { id?: string; title?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`nw-panel if-sec ${className ?? ""}`}>
      {title && <h2 className="nw-h if-h">{title}<span>//</span></h2>}
      {children}
    </section>
  );
}
