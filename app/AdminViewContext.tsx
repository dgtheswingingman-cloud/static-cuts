"use client";

import { createContext, useContext, useEffect, useState } from "react";

type AdminViewContextType = {
  viewAsNonAdmin: boolean;
  setViewAsNonAdmin: (v: boolean) => void;
};

const AdminViewContext = createContext<AdminViewContextType | undefined>(undefined);

const STORAGE_KEY = "admin_view_as_non_admin";

export function AdminViewProvider({ children }: { children: React.ReactNode }) {
  const [viewAsNonAdmin, setViewAsNonAdminState] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") setViewAsNonAdminState(true);
  }, []);

  function setViewAsNonAdmin(v: boolean) {
    setViewAsNonAdminState(v);
    localStorage.setItem(STORAGE_KEY, String(v));
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
