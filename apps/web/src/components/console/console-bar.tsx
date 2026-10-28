"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/brand/wordmark";
import { usePublicConfig } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { WalletCell } from "./wallet";

/*
 * The console's fixed bar: the same 64px hairline strip as the public page.
 * Left to right: the mark, the two destinations, then the venue and the
 * wallet. The venue is named in plain words in its own cell so a fork is
 * never mistaken for live chain 97, and the wallet menu sits beside it.
 */

const NAV = [
  { href: "/app", label: "Console" },
  { href: "/faucet", label: "Faucet" },
] as const;

type Venue = {
  /** Short form for narrow screens. */
  short: string;
  full: string;
  square: string;
};

function describeVenue(
  venue: "fork" | "testnet" | undefined,
  offline: boolean,
): Venue {
  if (venue === "fork") {
    return {
      short: "Fork",
      full: "Local fork of chain 97",
      square: "bg-statuspending",
    };
  }
  if (venue === "testnet") {
    return {
      short: "Testnet",
      full: "BSC Testnet · 97",
      square: "bg-signal",
    };
  }
  if (offline) {
    return { short: "Offline", full: "API offline", square: "bg-fail-ink" };
  }
  return {
    short: "Chain 97",
    full: "Chain 97",
    square: "bg-rule motion-safe:animate-blink",
  };
}

export function ConsoleBar() {
  const pathname = usePathname();
  const config = usePublicConfig();
  const venue = describeVenue(config.data?.venue, config.isError);

  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-ruleinvert bg-paper">
      <div className="flex h-16 items-stretch">
        <Link
          href="/"
          aria-label="Perago home"
          className="pressable flex shrink-0 items-center border-r border-ruleinvert px-4 hover:bg-ink/[0.03] md:w-52 md:px-5"
        >
          <Wordmark size="md" className="[&>span]:hidden md:[&>span]:block" />
        </Link>

        <nav aria-label="Console" className="flex min-w-0 items-stretch">
          {NAV.map((item) => {
            const active =
              item.href === "/app"
                ? pathname === "/app" || pathname.startsWith("/app/")
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group pressable relative flex items-center border-r border-rule px-3 font-mono text-[10px] uppercase tracking-[0.12em] sm:px-4 sm:text-[11px] sm:tracking-[0.16em] md:px-5",
                  active
                    ? "bg-ink/[0.04] text-ink"
                    : "text-fog hover:bg-ink/[0.02] hover:text-ink",
                )}
              >
                {item.label}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-0 bottom-0 h-0.5 origin-left bg-signal transition-transform duration-300 ease-out-vivid",
                    active
                      ? "scale-x-100"
                      : "scale-x-0 group-hover:scale-x-100 group-focus-visible:scale-x-100",
                  )}
                />
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1" />

        <div
          role="status"
          className="flex items-center gap-2.5 border-l border-rule px-3 font-mono text-[10px] uppercase tracking-[0.12em] sm:px-4 sm:text-[11px] sm:tracking-[0.16em] md:px-5"
        >
          <span aria-hidden className={cn("size-1.5 shrink-0", venue.square)} />
          <span className="sr-only">Network: </span>
          <span className="text-fog md:hidden">{venue.short}</span>
          <span className="hidden whitespace-nowrap text-fog md:inline">
            {venue.full}
          </span>
        </div>

        <WalletCell />
      </div>
    </header>
  );
}
