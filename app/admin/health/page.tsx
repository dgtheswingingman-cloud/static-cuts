// Site health now lives in the Control room.
import { redirect } from "next/navigation";

export default function HealthRedirect() {
  redirect("/control?tab=health");
}
