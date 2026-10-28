import type { Metadata } from "next";
import type { ReactNode } from "react";

/*
 * The page is a client component, so its title lives in this segment layout.
 * The template is restated because a plain string title here would drop the
 * root template for the task segment below.
 */
export const metadata: Metadata = {
  title: { default: "Console", template: "%s · Perago" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
