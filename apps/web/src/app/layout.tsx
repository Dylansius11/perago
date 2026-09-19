import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// The style entry (Tailwind import, theme tokens, fonts) is deliberately absent:
// it belongs to the UI task, which owns `components.json`, the CSS entry, and
// the design direction. Import it here as `./globals.css` when it exists.

export const metadata: Metadata = {
  title: {
    default: "Perago",
    template: "%s | Perago",
  },
  description: "Intent, carried through. Give the goal, not the wallet.",
};

export const viewport: Viewport = {
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
