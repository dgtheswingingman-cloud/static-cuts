import type { Metadata } from "next";
import { Anton, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import StaticOverlay from "./StaticOverlay";
import { AuthProvider } from "./AuthProvider";
import { AdminViewProvider } from "./AdminViewContext";
import { ThemeProvider } from "./ThemeProvider";

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Static Cuts//",
  description: "Cut through the noise.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${anton.variable} ${inter.variable} ${mono.variable}`}>
        <AuthProvider>
          <ThemeProvider>
            <AdminViewProvider>
              <StaticOverlay />
              <div className="scanlines" />
              {children}
              <footer className="site-credit">
                Some song data from{" "}
                <a href="https://open.spotify.com" target="_blank" rel="noopener noreferrer">Spotify</a>,{" "}
                <a href="https://genius.com" target="_blank" rel="noopener noreferrer">Genius</a> and{" "}
                <a href="https://www.last.fm" target="_blank" rel="noopener noreferrer">Last.fm</a>.{" "}
                <Link href="/legal">Legal</Link> · <Link href="/takedown">Request a takedown</Link>
              </footer>
            </AdminViewProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
