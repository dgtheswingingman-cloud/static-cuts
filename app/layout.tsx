import type { Metadata, Viewport } from "next";
import { Anton, Inter, Space_Mono } from "next/font/google";
import "./globals.css";
import "./styles/phone.css";
import "./styles/footer.css";
import "./styles/fixes.css";
import Link from "next/link";
import Script from "next/script";
import StaticOverlay from "./StaticOverlay";
import { AuthProvider } from "./AuthProvider";
import { AdminViewProvider } from "./AdminViewContext";
import { ThemeProvider } from "./ThemeProvider";
import RegisterServiceWorker from "./RegisterServiceWorker";
import SignupNudge from "./components/SignupNudge";
import OnboardingGate from "./components/OnboardingGate";
import { VisitorPreviewBar } from "./components/visitorPreview";
import ThemeSwitch from "./ThemeSwitch";
import SiteHome from "./SiteHome";
import DesktopNav from "./DesktopNav";
import PageBack from "./PageBack";
import MobileTabBar from "./MobileTabBar";
import SpotifyImportResume from "./SpotifyImportResume";
import SitePause from "./SitePause";
import AuthNotice from "./AuthNotice";
import UserAccent from "./UserAccent";

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = Space_Mono({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  metadataBase: new URL("https://static-cuts.com"),
  title: "Static-Cuts//",
  description: "Cut through the noise. A community archive of every song, leak and release.",
  openGraph: {
    siteName: "Static-Cuts//",
    title: "Static-Cuts//",
    description: "Cut through the noise. A community archive of every song, leak and release.",
    images: [{ url: "/icon-512.png", width: 512, height: 512 }],
  },
  twitter: { card: "summary" },
  appleWebApp: { capable: true, title: "Static-Cuts", statusBarStyle: "black-translucent" },
  icons: { apple: "/apple-touch-icon.png" },
  // Google Search Console ownership check.
  verification: { google: "1Kz4VbcAwwVd-DOxHnCA9NzYJyc8KfoTAe8iREFblGg" },
};

export const viewport: Viewport = {
  themeColor: "#070707",
  // Already dark: stops browsers (Opera GX, Chrome auto dark) recolouring it.
  colorScheme: "dark light",
  // Full-screen when saved to the home screen; the app bar and tab bar keep
  // clear of the notch and the home bar.
  viewportFit: "cover",
  // Phones: start at the page's real width and don't zoom out past it.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${anton.variable} ${inter.variable} ${mono.variable}`}>
        <AuthProvider>
          <ThemeProvider>
            <AdminViewProvider>
              <RegisterServiceWorker />
              <UserAccent />
              <StaticOverlay />
              <SpotifyImportResume />
              <div className="scanlines" />
              <VisitorPreviewBar />
              <DesktopNav />
              <SiteHome />
              <AuthNotice />
              <PageBack />
              <SitePause>{children}</SitePause>
              <OnboardingGate />
              <SignupNudge />
              <footer className="site-credit">
                <nav className="site-credit-links">
                  <Link href="/faq">FAQ</Link>
                  <Link href="/listen">How to listen</Link>
                  <Link href="/discord">Discord bot</Link>
                  <Link href="/contributors">Contributors</Link>
                  <Link href="/sources">Sources</Link>
                  <Link href="/legal">Privacy &amp; terms</Link>
                  <Link href="/takedown">Request a takedown</Link>
                  <ThemeSwitch />
                </nav>
                <nav className="site-social" aria-label="Static-Cuts// elsewhere">
                  <a href="https://x.com/StaticCuts" target="_blank" rel="noopener noreferrer" aria-label="X">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.3 21H2.2l7.2-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z"/></svg>
                    @StaticCuts
                  </a>
                  <a href="https://instagram.com/static.cuts.archive" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>
                    @static.cuts.archive
                  </a>
                  <a href="https://www.tiktok.com/@static.cuts.archive" target="_blank" rel="noopener noreferrer" aria-label="TikTok">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M16.6 3c.4 2 1.7 3.6 3.9 3.9v3.1c-1.5 0-2.9-.4-4-1.2v6.4c0 3.2-2.6 5.8-5.8 5.8S4.9 18.4 4.9 15.2s2.6-5.8 5.8-5.8c.3 0 .6 0 .9.1v3.2c-.3-.1-.6-.1-.9-.1-1.5 0-2.7 1.2-2.7 2.7s1.2 2.7 2.7 2.7 2.7-1.2 2.7-2.7V3h3.2z"/></svg>
                    @static.cuts.archive
                  </a>
                </nav>
                <div>
                  Some song data from{" "}
                  <a href="https://open.spotify.com" target="_blank" rel="noopener noreferrer">Spotify</a>,{" "}
                  <a href="https://genius.com" target="_blank" rel="noopener noreferrer">Genius</a>,{" "}
                  <a href="https://www.last.fm" target="_blank" rel="noopener noreferrer">Last.fm</a>,{" "}
                  <a href="https://listenbrainz.org" target="_blank" rel="noopener noreferrer">ListenBrainz</a> and{" "}
                  <a href="https://www.discogs.com" target="_blank" rel="noopener noreferrer">Discogs</a>.
                </div>
              </footer>
              <MobileTabBar />
            </AdminViewProvider>
          </ThemeProvider>
        </AuthProvider>
        {/* Vercel Web Analytics: page views, where visitors came from, country
            and device. No cookies, nothing personal. Only counts on the live site. */}
        <Script src="/_vercel/insights/script.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
