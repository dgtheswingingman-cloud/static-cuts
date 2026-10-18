import type { MetadataRoute } from "next";

// Lets people install the site as an app (home-screen icon, opens full
// screen, no app store).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Static Cuts//",
    short_name: "Static Cuts",
    description: "Cut through the noise. A community archive of every song, leak and release.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0A0A0A",
    theme_color: "#0A0A0A",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "What's new", url: "/new" },
      { name: "Search songs", url: "/search" },
      { name: "Lists", url: "/lists" },
    ],
  };
}
