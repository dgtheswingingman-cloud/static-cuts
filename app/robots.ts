import type { MetadataRoute } from "next";

// Search engines can read the archive, not the account or admin pages.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/review", "/control", "/settings", "/notifications", "/my-submissions", "/submit", "/login", "/spotify-callback", "/oauth"],
    },
    sitemap: "https://static-cuts.com/sitemap.xml",
  };
}
