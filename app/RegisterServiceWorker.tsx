"use client";

import { useEffect } from "react";

// Registers /sw.js so the site can be installed as an app.
export default function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.location.protocol === "https:") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
