import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Album of the week is picked in Posts & picks now (on the Monday).
export default function AlbumOfTheWeekMoved() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  redirect(`/review/social?day=${d.toLocaleDateString("en-CA")}`);
}
