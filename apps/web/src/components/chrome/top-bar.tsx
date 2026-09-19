import Link from "next/link";
import Image from "next/image";
import { UtcClock } from "./utc-clock";

/*
 * Fixed top bar. Occupies a single hairline-framed strip across the top of
 * the viewport, inside the page grid. Server component; the only client
 * island is the clock.
 */

export function TopBar() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-ruleinvert bg-paper">
      <div className="mx-auto flex h-16 max-w-[1560px] items-stretch">
        <Link
          href="/"
          className="flex w-40 items-center border-r border-ruleinvert px-5"
          aria-label="Perago home"
        >
          <Image
            className="h-7 w-auto"
            priority
          />
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
                className="flex items-center border-l border-rule px-5 font-mono text-[11px] uppercase tracking-[0.16em] text-fog transition-colors duration-200 hover:text-ink"
              >
                {label}
              </a>
            ))}
            <a
              href="#access"
              className="group flex items-center gap-3 border-l border-ruleinvert bg-ink px-6 text-[15px] font-medium text-paper transition-colors duration-200 hover:bg-panel"
            >
              Connect wallet
              <span
                aria-hidden
                className="font-mono transition-transform duration-200 group-hover:translate-x-1"
              >
                &#8594;
              </span>
            </a>
          </div>
        </nav>

        {/* Mobile: collapse the strip to logo plus a single anchor. */}
        <a
          href="#access"
          className="flex flex-1 items-center justify-end border-l border-ruleinvert bg-ink px-5 font-mono text-[11px] uppercase tracking-[0.16em] text-paper md:hidden"
        >
          Connect &#8594;
        </a>
      </div>
    </header>
