// The Inbox became Help Wanted in admin mode (fix the gaps on the spot);
// old links go there.

import { redirect } from "next/navigation";

export default function InboxGone() {
  redirect("/help");
}
