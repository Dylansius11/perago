import type { Metadata } from "next";
import type { ReactNode } from "react";

/* The page is a client component, so its title lives in this segment layout. */
export const metadata: Metadata = { title: "Task" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
