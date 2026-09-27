import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { UtcClock } from "./utc-clock";

/*
 * Fixed top bar for the public pages. A single hairline-framed strip across
 * the top of the viewport, inside the page grid. Server component; the only
 * client island is the clock. The console has its own bar with wallet state.
 */

const SECTIONS = [
  ["Mandate", "/#mandate"],
  ["Failure", "/#execution"],
  ["Receipt", "/#evidence"],
] as const;

export function TopBar() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-ruleinvert bg-paper">
      <div className="flex h-16 items-stretch">
        <Link
          href="/"
          className="flex w-44 shrink-0 items-center border-r border-ruleinvert px-5 md:w-52"
          aria-label="Perago home"
        >
          <Wordmark size="md" />
        </Link>

        <nav
          aria-label="Primary"
          className="hidden flex-1 items-stretch md:flex"
        >
          <div className="hidden flex-1 items-center px-6 font-mono text-[11px] uppercase tracking-[0.16em] text-fog lg:flex">
            <UtcClock />
          </div>
          <div className="ml-auto flex items-stretch">
            {SECTIONS.map(([label, href]) => (
              <a
                key={label}
                href={href}
                className="group pressable relative flex items-center border-l border-rule px-5 font-mono text-[11px] uppercase tracking-[0.16em] text-fog hover:text-ink"
              >
                {label}
                <span
                  aria-hidden
                  className="absolute bottom-4 left-5 h-px w-[calc(100%-2.5rem)] origin-left scale-x-0 bg-signal transition-transform duration-300 ease-out-vivid group-hover:scale-x-100"
                />
              </a>
            ))}
            <Link
              href="/faucet"
              className="group pressable relative flex items-center border-l border-rule px-5 font-mono text-[11px] uppercase tracking-[0.16em] text-fog hover:text-ink"
            >
              Faucet
              <span
                aria-hidden
                className="absolute bottom-4 left-5 h-px w-[calc(100%-2.5rem)] origin-left scale-x-0 bg-signal transition-transform duration-300 ease-out-vivid group-hover:scale-x-100"
              />
            </Link>
            <Link
              href="/app"
              className="group pressable flex items-center gap-3 whitespace-nowrap border-l border-ruleinvert bg-ink px-6 text-[15px] font-medium text-paper hover:bg-signal hover:text-ink"
            >
              Open console
              <span
                aria-hidden
                className="arrow font-mono group-hover:translate-x-1"
              >
                &#8594;
              </span>
            </Link>
          </div>
        </nav>

        {/* Mobile: collapse the strip to logo plus a single action. */}
        <Link
          href="/app"
          className="pressable flex flex-1 items-center justify-end gap-2 whitespace-nowrap border-l border-ruleinvert bg-ink px-5 font-mono text-[11px] uppercase tracking-[0.16em] text-paper hover:bg-signal hover:text-ink md:hidden"
        >
          Console <span aria-hidden>&#8594;</span>
        </Link>
      </div>
    </header>
  );
}
