// Moderation now lives in the Control room.
import { redirect } from "next/navigation";

export default function ReviewRedirect() {
  redirect("/control");
}
