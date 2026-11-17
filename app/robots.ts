import type { MetadataRoute } from "next";
import { SITEMAP_PARTS } from "./sitemap";

// Search engines can read the archive, not the account or admin pages.
// Share pictures (the image under a link) are skipped by general crawlers:
// from 13 to 16 Nov 2026 crawlers walking the sitemap fetched ~30,000 a day,
// which used up the hosting allowance. Link-preview bots (Discord, X, Reddit,
// chat apps) still get them, so shared links keep their picture.
const PRIVATE = ["/admin", "/review", "/control", "/settings", "/notifications", "/my-submissions", "/submit", "/login", "/spotify-callback", "/oauth"];
const PREVIEW_BOTS = ["Twitterbot", "facebookexternalhit", "Facebot", "Discordbot", "Slackbot", "Slackbot-LinkExpanding", "TelegramBot", "WhatsApp", "redditbot", "LinkedInBot", "Applebot", "Embedly", "iMessageLinkPreview"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: [...PRIVATE, "/song/*/opengraph-image", "/artist/*/opengraph-image", "/*/opengraph-image*"] },
      { userAgent: PREVIEW_BOTS, allow: "/", disallow: PRIVATE },
    ],
    sitemap: Array.from({ length: SITEMAP_PARTS }, (_, i) => `https://static-cuts.com/sitemap/${i}.xml`),
  };
}
