"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/brand/wordmark";
import { usePublicConfig } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { WalletCell } from "./wallet";

/*
 * The console's fixed bar: the same 64px hairline strip as the public page,
 * with the venue named in plain words next to the mark, so a fork is never
 * mistaken for live chain 97.
 */

const NAV = [
  { href: "/app", label: "Console" },
  { href: "/faucet", label: "Faucet" },
] as const;

export function ConsoleBar() {
  const pathname = usePathname();
  const config = usePublicConfig();
  const venue = config.data?.venue;

  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-ruleinvert bg-paper">
      <div className="flex h-16 items-stretch">
        <Link
          href="/"
          aria-label="Perago home"
          className="flex shrink-0 items-center border-r border-ruleinvert px-2 sm:px-4 md:w-52 md:px-5"
        >
          <Wordmark size="md" className="[&>span]:hidden md:[&>span]:block" />
        </Link>

        <div className="hidden items-center gap-3 border-r border-rule px-5 font-mono text-[11px] uppercase tracking-[0.16em] lg:flex">
          <span
            aria-hidden
            className={cn(
              "size-1.5",
              venue === "fork"
                ? "bg-statuspending"
                : venue === "testnet"
                  ? "bg-signal"
                  : "bg-rule",
            )}
          />
          <span className="text-fog">
            {venue === "fork"
              ? "Local fork of chain 97"
              : venue === "testnet"
                ? "BSC Testnet · 97"
                : config.isError
                  ? "API offline"
                  : "Chain 97"}
          </span>
        </div>

        <nav aria-label="Console" className="flex min-w-0 flex-1 items-stretch">
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
                  "group pressable relative flex items-center border-r border-rule px-2 font-mono text-[10px] uppercase tracking-[0.12em] sm:px-4 sm:text-[11px] sm:tracking-[0.16em] md:px-5",
                  active ? "text-ink" : "text-fog hover:text-ink",
                )}
              >
                {item.label}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-4 bottom-0 h-0.5 origin-left bg-signal transition-transform duration-300 ease-out-vivid md:inset-x-5",
                    active
                      ? "scale-x-100"
                      : "scale-x-0 group-hover:scale-x-100",
                  )}
                />
              </Link>
            );
          })}
        </nav>

        <WalletCell />
      </div>
    </header>
  );
}
