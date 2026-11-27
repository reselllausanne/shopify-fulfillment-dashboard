import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import { BUSINESS } from "./business";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${BUSINESS.name} | Barbier à Lausanne, Avenue Alexandre-Vinet`,
  description: `${BUSINESS.name}, barbier à Lausanne (${BUSINESS.streetAddress}, ${BUSINESS.postalCode} ${BUSINESS.locality}). Appelez le ${BUSINESS.phoneDisplay}.`,
  // Page de démonstration : ne pas indexer.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#14110f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr-CH" className={`${display.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
