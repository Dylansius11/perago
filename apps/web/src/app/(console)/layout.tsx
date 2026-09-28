import type { ReactNode } from "react";
import { ConsoleBar } from "@/components/console/console-bar";
import { ConsoleProviders } from "@/components/console/providers";

/*
 * Console routes share the wallet, query, and session providers. The public
 * landing page stays outside this group, so it ships without wallet code.
 */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <ConsoleProviders>
      <ConsoleBar />
      <main className="min-h-dvh bg-paper pt-16">
        <div className="mx-auto w-full px-4 pb-24 pt-8 md:px-10 md:pt-10">
          {children}
        </div>
      </main>
    </ConsoleProviders>
  );
}
