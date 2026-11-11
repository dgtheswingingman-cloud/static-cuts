"use client";

// Admin mode (admin accounts only), in Settings for phones; computers have the
// same switch at the bottom of the side menu.

import { useIsRealAdmin } from "../useIsAdmin";
import { useAdminView } from "../AdminViewContext";
import Switch from "./Switch";

export default function AdminModeSwitch() {
  const isRealAdmin = useIsRealAdmin();
  const { adminMode, setAdminMode } = useAdminView();
  if (!isRealAdmin) return null;
  return (
    <section className="nw-panel st-box st-full">
      <h2 className="nw-h st-h">Admin<span>//</span></h2>
      <div className="st-row">
        <span className="st-row-text">
          <span>Admin mode</span>
          <small>Admin jobs, with the control room in the menu. Off, the site is exactly as your own account sees it. Remembered on this device.</small>
        </span>
        <Switch on={adminMode} label="Admin mode" onChange={() => setAdminMode(!adminMode)} />
      </div>
    </section>
  );
}
