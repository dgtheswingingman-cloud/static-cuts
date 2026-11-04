"use client";

// What's new: songs added and status changes, grouped per artist per day.

import WhatsNew from "./WhatsNew";

export default function WhatsNewPage() {
  return <WhatsNew followingOnly={false} />;
}
