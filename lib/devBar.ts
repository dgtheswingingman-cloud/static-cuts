// "Dev options" in Settings (admin account only): whether the admin bar
// shows at the top of every page. Remembered on this device; off by default.

import { local } from "@/lib/safeStorage";

const KEY = "static_cuts_dev_bar";
export const DEV_BAR_EVENT = "sc-devbar";

export function devBarOn(): boolean {
  return local.get(KEY) === "1";
}

export function setDevBar(on: boolean) {
  if (on) local.set(KEY, "1"); else local.remove(KEY);
  window.dispatchEvent(new Event(DEV_BAR_EVENT));
}
