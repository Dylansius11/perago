import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { UtcClock } from "./utc-clock";

/*
 * Fixed top bar. Occupies a single hairline-framed strip across the top of
 * the viewport, inside the page grid. Server component; the only client
 * island is the clock.
 */

export function TopBar() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-ruleinvert bg-paper">
      <div className="flex h-16 items-stretch">
        <Link
          href="/"
          className="flex w-52 items-center border-r border-ruleinvert px-5"
          aria-label="Perago home"
        >
          <Wordmark size="md" />
        </Link>

        <nav
          aria-label="Primary"
          className="hidden flex-1 items-stretch md:flex"
        >
          <div className="flex flex-1 items-center px-6 font-mono text-[11px] uppercase tracking-[0.16em] text-fog">
            <UtcClock />
          </div>
          <div className="flex items-stretch">
            {[
              ["Mandate", "#mandate"],
              ["Execution", "#execution"],
              ["Evidence", "#evidence"],
            ].map(([label, href]) => (
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
            <a
              href="#access"
              className="group pressable flex items-center gap-3 border-l border-ruleinvert bg-ink px-6 text-[15px] font-medium text-paper hover:bg-signal hover:text-ink"
            >
              Connect wallet
              <span aria-hidden className="arrow font-mono group-hover:translate-x-1">
                &#8594;
              </span>
            </a>
          </div>
        </nav>

        {/* Mobile: collapse the strip to logo plus a single anchor. */}
        <a
          href="#access"
          className="pressable flex flex-1 items-center justify-end gap-2 border-l border-ruleinvert bg-ink px-5 font-mono text-[11px] uppercase tracking-[0.16em] text-paper hover:bg-signal hover:text-ink md:hidden"
        >
          Connect <span aria-hidden>&#8594;</span>
        </a>
      </div>
    </header>
  );
}
