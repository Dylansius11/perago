import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Archivo, JetBrains_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: {
    default: "Perago",
    template: "%s | Perago",
  },
  description:
    "A bounded execution layer for onchain agents. Give the goal, not the wallet.",
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
