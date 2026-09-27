import { Wordmark } from "@/components/brand/wordmark";

/*
 * Footer. A normal, in-flow block at the end of the document: it scrolls
 * with the page and never follows the viewport. Three zones separated by
 * hairlines: the mark, the navigation, and the release facts.
 */

const NAV = [
  ["Mandate", "/#mandate"],
  ["Failure", "/#execution"],
  ["Receipt", "/#evidence"],
  ["Faucet", "/faucet"],
  ["Console", "/app"],
] as const;

export function SiteFooter() {
  return (
    <footer className="rain border-t border-ruleinvert bg-ink text-paper">
      <div className="px-6 py-14 md:px-10">
        <div className="flex flex-col gap-10 md:flex-row md:items-end md:justify-between">
          <Wordmark tone="paper" size="lg" />
          <nav aria-label="Footer" className="flex flex-wrap gap-x-10 gap-y-4">
            {NAV.map(([label, href]) => (
              <a
                key={label}
                href={href}
                className="group pressable relative font-mono text-[12px] uppercase tracking-[0.16em] text-paper/60 hover:text-signal"
              >
                {label}
                <span
                  aria-hidden
                  className="absolute -bottom-1.5 left-0 h-px w-full origin-left scale-x-0 bg-signal transition-transform duration-300 ease-out-vivid group-hover:scale-x-100"
                />
              </a>
            ))}
          </nav>
        </div>

        <div className="mt-14 flex flex-col gap-2 border-t border-ruleinvert pt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-paper/45 md:flex-row md:items-center md:justify-between">
          <span>&copy; 2026 Perago</span>
          <span>BSC Testnet &middot; Chain 97</span>
        </div>
      </div>
    </footer>
  );
}
