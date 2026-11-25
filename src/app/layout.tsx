import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const serif = localFont({ src: "./fonts/cormorant-garamond-latin.woff2", weight: "400 700", display: "swap", variable: "--font-cormorant" });
const sans = localFont({ src: "./fonts/inter-latin.woff2", weight: "100 900", display: "swap", variable: "--font-inter" });
const hand = localFont({ src: "./fonts/caveat-latin.woff2", weight: "500 700", display: "swap", variable: "--font-caveat" });

export const metadata: Metadata = { title: "OUR UNIVERSE", description: "A private universe for two." };
export const viewport: Viewport = { themeColor: "#080B1A" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${hand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
