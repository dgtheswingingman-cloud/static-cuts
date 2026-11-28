// Most Wanted was removed; old links go to the homepage.

import { permanentRedirect } from "next/navigation";

export default function WantedGone() {
  permanentRedirect("/");
}
