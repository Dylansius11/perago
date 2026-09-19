/*
 * The mandate ledger strip: a marquee of one-use authority facts. Each cell
 * is a real contract fact, not marketing filler. Loop is continuous and
 * linear; pauses on hover; frozen entirely under reduced motion.
 */

const FACTS: Array<[string, string]> = [
  ["NONCE", "single use"],
  ["SPEND", "max input, on mandate"],
  ["ROUTING", "allowlisted adapters"],
  ["CALLDATA", "compiled, never free-form"],
  ["RECIPIENT", "self, unless you widen it"],
  ["EXPIRY", "authority dies with the clock"],
  ["POSTCONDITION", "deterministic verifier"],
  ["REPLAY", "consumed at authorize"],
  ["SESSION", "transport only, no keys"],
  ["RECEIPT", "public, onchain"],
];

export function LedgerStrip() {
  const cells = FACTS.map(([term, definition]) => (
    <div
      key={term}
      className="flex shrink-0 items-baseline gap-3 border-r border-ruleinvert px-8 py-5"
    >
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-signaldeep">
        {term}
      </span>
      <span className="text-[15px] text-ink">{definition}</span>
    </div>
  ));

  return (
    <section
      aria-label="Mandate constraints"
      className="overflow-hidden border-b border-ruleinvert bg-paper"
    >
      <div className="group flex w-max motion-safe:animate-marquee motion-safe:group-hover:[animation-play-state:paused]">
        {cells}
        <div aria-hidden className="contents">
          {cells}
        </div>
      </div>
    </section>
  );
}
