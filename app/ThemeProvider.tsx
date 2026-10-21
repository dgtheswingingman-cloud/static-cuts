"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { local } from "@/lib/safeStorage";

type ThemeName = "dark" | "light";

type ThemeContextType = {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = "static_cuts_theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>("dark");

  useEffect(() => {
    const stored = local.get(STORAGE_KEY) as ThemeName | null;
    if (stored === "dark" || stored === "light") {
      setThemeState(stored);
    }
  }, []);

  function setTheme(t: ThemeName) {
    setThemeState(t);
    local.set(STORAGE_KEY, t);
  }

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
