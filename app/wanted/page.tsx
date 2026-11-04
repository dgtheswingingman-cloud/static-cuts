// Most Wanted was removed; old links go to the homepage.

import { redirect } from "next/navigation";

export default function WantedGone() {
  redirect("/");
}
