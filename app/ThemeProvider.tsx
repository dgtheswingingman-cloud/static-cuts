"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { colorForGenre, rgbToHex } from "./genreColors";
import { useAuth } from "./AuthProvider";

type ThemeName = "dark" | "light" | "personalized";

type ThemeContextType = {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = "static_cuts_theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [theme, setThemeState] = useState<ThemeName>("dark");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
    if (stored === "dark" || stored === "light" || stored === "personalized") {
      setThemeState(stored);
    }
  }, []);

  function setTheme(t: ThemeName) {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
  }

  // Apply the light/dark base via a data attribute on <html>.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
  }, [theme]);

  // For "personalized": compute a weighted-average accent color from the
  // genres of everyone this user follows, and apply it as a CSS variable
  // override. Falls back to no override (default white accent) if not
  // logged in, following nobody, or none of them have a genre tagged yet.
  useEffect(() => {
    async function applyPersonalizedAccent() {
      if (theme !== "personalized" || !user) {
        document.documentElement.style.removeProperty("--accent");
        return;
      }

      const { data: follows } = await supabase.from("follows").select("artist_id").eq("user_id", user.id);
      const artistIds = (follows ?? []).map((f) => f.artist_id);
      if (artistIds.length === 0) {
        document.documentElement.style.removeProperty("--accent");
        return;
      }

      const { data: artists } = await supabase.from("artists").select("genre").in("id", artistIds);
      const genres = (artists ?? []).map((a) => a.genre).filter(Boolean) as string[];
      if (genres.length === 0) {
        document.documentElement.style.removeProperty("--accent");
        return;
      }

      let rSum = 0, gSum = 0, bSum = 0;
      genres.forEach((g) => {
        const [r, gc, b] = colorForGenre(g);
        rSum += r; gSum += gc; bSum += b;
      });
      const blended: [number, number, number] = [rSum / genres.length, gSum / genres.length, bSum / genres.length];
      document.documentElement.style.setProperty("--accent", rgbToHex(blended));
    }
    applyPersonalizedAccent();
  }, [theme, user]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
