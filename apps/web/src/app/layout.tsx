import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

const SITE_URL = "https://perago-app.vercel.app";
const TITLE = "Perago · Give the goal, not the wallet";
const DESCRIPTION =
  "State a goal, sign one mandate. Perago swaps or stakes within your limits, verifies the result onchain, then ends its authority. BNB Smart Chain Testnet.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · Perago",
  },
  description: DESCRIPTION,
  applicationName: "Perago",
  openGraph: {
    type: "website",
    siteName: "Perago",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#0c120e",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${jetbrains.variable}`}>
      <head>
        {/*
         * Entrance animations ship their start state inline, so without
         * JavaScript the page would render invisible. This override wins
         * over those inline declarations and hands the reader the content.
         */}
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important;clip-path:none!important;filter:none!important}`}</style>
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  );
}
