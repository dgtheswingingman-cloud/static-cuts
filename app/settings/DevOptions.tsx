"use client";

// Dev options (admin account only): show the admin bar at the top of pages.

import { useEffect, useState } from "react";
import { useIsRealAdmin } from "../useIsAdmin";
import { devBarOn, setDevBar } from "@/lib/devBar";
import Switch from "./Switch";

export default function DevOptions() {
  const isRealAdmin = useIsRealAdmin();
  const [on, setOn] = useState(false);
  useEffect(() => { setOn(devBarOn()); }, []);
  if (!isRealAdmin) return null;
  return (
    <section className="nw-panel st-box st-full">
      <h2 className="nw-h st-h">Dev options<span>//</span></h2>
      <div className="st-row">
        <span className="st-row-text">
          <span>Show the admin bar</span>
          <small>The bar at the top for switching between admin mode and your account, previewing as a new visitor, and the admin shortcuts. Remembered on this device.</small>
        </span>
        <Switch on={on} label="Show the admin bar" onChange={() => { setDevBar(!on); setOn(!on); }} />
      </div>
    </section>
  );
}
