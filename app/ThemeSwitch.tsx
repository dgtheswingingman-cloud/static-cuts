"use client";

// Dark / light switch in the footer.

import { useTheme } from "./ThemeProvider";

export default function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return (
    <button className="inline-link-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      {theme === "dark" ? "light mode" : "dark mode"}
    </button>
  );
}
