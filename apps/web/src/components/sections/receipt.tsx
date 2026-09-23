import { RiseIn, Unveil } from "@/components/motion/reveal";
import { Caption } from "@/components/primitives";

/*
 * The receipt: the public, permanent record. A full-bleed ink section with
 * the receipt rendered as the product artifact it is, plus the three
 * properties that make it trustworthy: public, deterministic, replay-safe.
 */

const PROOFS: Array<[string, string]> = [
  [
    "Public",
    "Receipts are queryable by anyone. Commitments, transactions, and the terminal state are onchain facts, not screenshots.",
  ],
  [
    "Deterministic",
    "The same inputs produce the same verdict, every time. Verification is adapter code, not a model's opinion of success.",
  ],
  [
    "Replay-safe",
    "Idempotent reconciliation means the executor can crash, restart, and redeliver without ever double-spending authority.",
  ],
];

export function Receipt() {
  return (
    <section id="evidence" className="scroll-mt-16 border-b border-ruleinvert">
      <div className="rain bg-ink text-paper">
        <div className="px-6 py-16 md:px-10">
          <RiseIn>
            <Caption>Execution Receipt</Caption>
            <h2 className="max-w-[22ch] text-4xl font-semibold tracking-[-0.03em] md:text-6xl">
              The receipt is the proof. Payment follows it.
            </h2>
          </RiseIn>

          <div className="mt-14 grid gap-10 md:grid-cols-12">
            {/* The receipt specimen */}
            <Unveil className="md:col-span-7">
              <div className="border border-ruleinvert bg-panel">
                <div className="flex items-center justify-between border-b border-ruleinvert px-6 py-4">
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper/50">
                    Receipt 0007
                  </span>
                  <span className="flex items-center gap-2 font-mono text-[11px] text-statusok">
                    <span
                      aria-hidden
                      className="size-1.5 bg-statusok motion-safe:animate-blink"
                    />
                    SUCCEEDED
                  </span>
                </div>
                <dl className="divide-y divide-ruleinvert font-mono text-[13px]">
                  {[
                    ["mandate", "nonce 0007, consumed"],
                    ["userOperation", "0x9d7f…e2f1"],
                    ["block", "47,218,559"],
                    ["adapter", "pancakeswap.v3"],
                    ["in", "0.05 BNB (measured)"],
                    ["out", "29.92 USDT (measured)"],
                    ["verifier", "postcondition PASS"],
                    ["payment", "settled on verification"],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      className="flex items-baseline justify-between gap-6 px-6 py-3 transition-colors duration-200 ease-out-vivid hover:bg-paper/[0.04]"
                    >
                      <dt className="text-paper/50">{k}</dt>
                      <dd className="text-right text-paper/85">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="border-t border-ruleinvert px-6 py-4">
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper/40">
                    Illustrative values on real field names
                  </span>
                </div>
              </div>
            </Unveil>

            {/* The three proofs */}
            <div className="flex flex-col justify-center gap-10 md:col-span-5">
              {PROOFS.map(([title, body], i) => (
                <RiseIn key={title} delay={0.08 * i}>
                  <div className="border-t border-ruleinvert pt-5">
                    <h3 className="text-xl font-semibold tracking-[-0.01em] text-signal">
                      {title}
                    </h3>
                    <p className="mt-2 max-w-[40ch] leading-relaxed text-paper/70">
                      {body}
                    </p>
                  </div>
                </RiseIn>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
