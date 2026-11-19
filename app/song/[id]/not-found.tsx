// A song link that goes nowhere (deleted, or a typo): sent as a real 404 so
// search engines drop it, with the site around it as usual.

import Link from "next/link";

export default function SongNotFound() {
  return (
    <div className="wrap">
      <div className="empty-state" style={{ marginTop: 30 }}>
        This song isn&apos;t in the archive (it may have been deleted). <Link href="/search" className="text-link">Search the archive →</Link>
      </div>
    </div>
  );
}
