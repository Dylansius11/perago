import Image from "next/image";

/*
 * Footer: a half-height fixed ink layer revealed as the page scrolls past
 * its end. The page content has bottom padding equal to the layer height so
 * the last section never hides beneath it. Three cells on desktop, stacking
 * on mobile.
 */

const NAV = [
  ["Mandate", "#mandate"],
  ["Execution", "#execution"],
  ["Evidence", "#evidence"],
  ["Access", "#access"],
] as const;

export function SiteFooter() {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 hidden h-56 border-t border-ruleinvert bg-ink text-paper md:block">
      <div className="rain mx-auto grid h-full max-w-[1560px] grid-cols-[1fr_auto]">
        <div className="flex min-w-0 flex-col justify-between py-6 pl-6">
          <Image
            src="/brand/primary-mark.png"
            alt="Perago"
            width={200}
            height={102}
            className="h-12 w-auto"
          />
          <nav aria-label="Footer" className="flex gap-7">
            {NAV.map(([label, href]) => (
              <a
                key={label}
                href={href}
                className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper/60 transition-colors duration-200 hover:text-signal"
              >
                {label}
              </a>
            ))}
          </nav>
        </div>

        <div className="flex flex-col justify-between border-l border-ruleinvert py-6 pr-6 text-right">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper/50">
            BSC Testnet &middot; Phase 2
          </p>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper/50">
            &copy; 2026 Perago
          </p>
        </div>
      </div>
    </footer>
  );
}

/** Mobile footer: static, since the fixed reveal is a desktop device. */
export function SiteFooterMobile() {
  return (
    <footer className="border-t border-ruleinvert bg-ink px-6 py-10 text-paper md:hidden">
      <Image
        src="/brand/primary-mark.png"
        alt="Perago"
        width={200}
        height={102}
        className="h-12 w-auto"
      />
      <nav aria-label="Footer" className="mt-6 flex flex-col gap-3">
        {NAV.map(([label, href]) => (
          <a
            key={label}
            href={href}
            className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper/60"
          >
            {label}
          </a>
        ))}
      </nav>
      <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.16em] text-paper/50">
        &copy; 2026 Perago &middot; BSC Testnet &middot; Phase 2
      </p>
    </footer>
  );
}
