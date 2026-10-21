import type { Metadata, Viewport } from "next";
import { Anton, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import StaticOverlay from "./StaticOverlay";
import { AuthProvider } from "./AuthProvider";
import { AdminViewProvider } from "./AdminViewContext";
import { ThemeProvider } from "./ThemeProvider";
import RegisterServiceWorker from "./RegisterServiceWorker";
import ModeBar from "./ModeBar";
import ThemeSwitch from "./ThemeSwitch";
import SiteHome from "./SiteHome";

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

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
};

export const viewport: Viewport = {
  themeColor: "#0A0A0A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${anton.variable} ${inter.variable} ${mono.variable}`}>
        <AuthProvider>
          <ThemeProvider>
            <AdminViewProvider>
              <RegisterServiceWorker />
              <StaticOverlay />
              <div className="scanlines" />
              <ModeBar />
              <SiteHome />
              {children}
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
            </AdminViewProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
