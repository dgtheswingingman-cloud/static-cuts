"use client";

import { createContext, useContext, useState } from "react";
import { local } from "@/lib/safeStorage";

type AdminViewContextType = {
  viewAsNonAdmin: boolean;
  setViewAsNonAdmin: (v: boolean) => void;
};

const AdminViewContext = createContext<AdminViewContextType | undefined>(undefined);

const STORAGE_KEY = "admin_view_as_non_admin";

export function AdminViewProvider({ children }: { children: React.ReactNode }) {
  // Read straight away (not after the first render), so pages don't start
  // in admin mode and then flip to "your account". Safe on the server: no one
  // is signed in until the browser has loaded the session.
  const [viewAsNonAdmin, setViewAsNonAdminState] = useState(() => typeof window !== "undefined" && local.get(STORAGE_KEY) === "true");

  function setViewAsNonAdmin(v: boolean) {
    setViewAsNonAdminState(v);
    local.set(STORAGE_KEY, String(v));
    // Reload so every part of the page starts again in the new mode, rather
    // than some parts showing the old one.
    window.location.reload();
  }

  return (
    <AdminViewContext.Provider value={{ viewAsNonAdmin, setViewAsNonAdmin }}>
      {children}
    </AdminViewContext.Provider>
  );
}

export function useAdminView() {
  const ctx = useContext(AdminViewContext);
  if (!ctx) throw new Error("useAdminView must be used inside <AdminViewProvider>");
  return ctx;
}
