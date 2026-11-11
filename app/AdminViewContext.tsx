"use client";

// Admin mode, for admin accounts: one switch (side menu on computers,
// Settings on phones). Off: the site exactly as your own account. On: admin
// jobs, with the control room in the menu. Remembered on this device; off
// until you turn it on.

import { createContext, useContext, useState } from "react";
import { local } from "@/lib/safeStorage";

type AdminViewContextType = {
  adminMode: boolean;
  setAdminMode: (on: boolean) => void;
  // The same switch the other way round (older code asks "view as non-admin?").
  viewAsNonAdmin: boolean;
  setViewAsNonAdmin: (v: boolean) => void;
};

const AdminViewContext = createContext<AdminViewContextType | undefined>(undefined);

const STORAGE_KEY = "static_cuts_admin_mode";

export function AdminViewProvider({ children }: { children: React.ReactNode }) {
  // Read straight away (not after the first render), so pages don't start in
  // one mode and then flip. Safe on the server: no one is signed in until the
  // browser has loaded the session.
  const [adminMode, setAdminModeState] = useState(() => typeof window !== "undefined" && local.get(STORAGE_KEY) === "1");

  function setAdminMode(on: boolean) {
    setAdminModeState(on);
    if (on) local.set(STORAGE_KEY, "1"); else local.remove(STORAGE_KEY);
    // Reload so every part of the page starts again in the new mode, rather
    // than some parts showing the old one. Leaving admin mode on an admin-only
    // page goes home instead.
    if (!on && /^\/(control|review|admin)(\/|$)/.test(window.location.pathname)) window.location.assign("/");
    else window.location.reload();
  }

  return (
    <AdminViewContext.Provider value={{ adminMode, setAdminMode, viewAsNonAdmin: !adminMode, setViewAsNonAdmin: (v) => setAdminMode(!v) }}>
      {children}
    </AdminViewContext.Provider>
  );
}

export function useAdminView() {
  const ctx = useContext(AdminViewContext);
  if (!ctx) throw new Error("useAdminView must be used inside <AdminViewProvider>");
  return ctx;
}
