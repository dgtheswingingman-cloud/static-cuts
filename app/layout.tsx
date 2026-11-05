import type { Metadata, Viewport } from "next";
import { Anton, Inter, Space_Mono } from "next/font/google";
import "./globals.css";
import "./styles/phone.css";
import Link from "next/link";
import StaticOverlay from "./StaticOverlay";
import { AuthProvider } from "./AuthProvider";
import { AdminViewProvider } from "./AdminViewContext";
import { ThemeProvider } from "./ThemeProvider";
import RegisterServiceWorker from "./RegisterServiceWorker";
import ModeBar from "./ModeBar";
import SignupNudge from "./components/SignupNudge";
import OnboardingGate from "./components/OnboardingGate";
import { VisitorPreviewBar } from "./components/visitorPreview";
import ThemeSwitch from "./ThemeSwitch";
import SiteHome from "./SiteHome";
import DesktopNav from "./DesktopNav";
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
  title: "Static Cuts//",
  description: "Cut through the noise. A community archive of every song, leak and release.",
  openGraph: {
    siteName: "Static Cuts//",
    title: "Static Cuts//",
    description: "Cut through the noise. A community archive of every song, leak and release.",
    images: [{ url: "/icon-512.png", width: 512, height: 512 }],
  },
  twitter: { card: "summary" },
  appleWebApp: { capable: true, title: "Static Cuts", statusBarStyle: "black-translucent" },
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
              <ModeBar />
              <VisitorPreviewBar />
              <DesktopNav />
              <SiteHome />
              <AuthNotice />
              <SitePause>{children}</SitePause>
              <OnboardingGate />
              <SignupNudge />
              <footer className="site-credit">
                <nav className="site-credit-links">
                  <Link href="/faq">FAQ</Link>
                  <Link href="/listen">How to listen</Link>
                  <Link href="/contributors">Contributors</Link>
                  <Link href="/sources">Sources</Link>
                  <Link href="/legal">Privacy &amp; terms</Link>
                  <Link href="/takedown">Request a takedown</Link>
                  <ThemeSwitch />
                </nav>
                <div>
                  Some song data from{" "}
                  <a href="https://open.spotify.com" target="_blank" rel="noopener noreferrer">Spotify</a>,{" "}
                  <a href="https://genius.com" target="_blank" rel="noopener noreferrer">Genius</a> and{" "}
                  <a href="https://www.last.fm" target="_blank" rel="noopener noreferrer">Last.fm</a>.
                </div>
              </footer>
              <MobileTabBar />
            </AdminViewProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
