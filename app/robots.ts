import type { MetadataRoute } from "next";
import { SITEMAP_PARTS } from "./sitemap";

// Search engines can read the archive, not the account or admin pages.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/review", "/control", "/settings", "/notifications", "/my-submissions", "/submit", "/login", "/spotify-callback", "/oauth"],
    },
    sitemap: Array.from({ length: SITEMAP_PARTS }, (_, i) => `https://static-cuts.com/sitemap/${i}.xml`),
  };
}
