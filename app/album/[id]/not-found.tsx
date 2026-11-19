// An album link that goes nowhere: a real 404, with the site around it.

import Link from "next/link";

export default function AlbumNotFound() {
  return (
    <div className="wrap">
      <div className="empty-state" style={{ marginTop: 30 }}>
        This album isn&apos;t in the archive. <Link href="/search" className="text-link">Search the archive →</Link>
      </div>
    </div>
  );
}
