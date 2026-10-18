"use client";

// Shown on admin and moderator pages to anyone who can't use them, instead
// of a blank page or a sudden bounce to the home page.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../AuthProvider";
import { useIsRealAdmin } from "../useIsAdmin";

export default function NoAccess({ loading, who }: { loading: boolean; who: "admin" | "moderators" }) {
  const { user } = useAuth();
  const path = usePathname();
  if (loading) return <div className="wrap"><div className="empty-state">loading…</div></div>;
  return (
    <div className="wrap">
      <Link href="/" className="back-btn">← home</Link>
      <div className="empty-state" style={{ marginTop: 18 }}>
        {who === "admin" ? "This page is only for the site admin." : "This page is for moderators."}{" "}
        {user ? (
          <>Want to help out? <Link href="/faq#moderators" className="text-link">Here&apos;s how moderating works</Link>.</>
        ) : (
          <><Link href={`/login?next=${encodeURIComponent(path ?? "/")}`} className="text-link">Log in</Link> if you have access.</>
        )}
      </div>
    </div>
  );
}

// "undo history" link for pages moderators can use: the undo page itself is
// admin-only, so moderators get plain text instead of a link that bounces.
export function UndoHistoryLink({ children = "undo history" }: { children?: React.ReactNode }) {
  const isAdmin = useIsRealAdmin();
  if (isAdmin) return <Link href="/admin/batches" className="text-link">{children}</Link>;
  return <>{children}</>;
}
