import Link from "next/link";
import { RiseIn } from "@/components/motion/reveal";

/*
 * Closing statement and access anchor. Big type, honest links, nothing
 * fake: no fake testimonials, no fake metrics, no fake roadmap.
 */

export function Closing() {
  return (
    <section id="access" className="scroll-mt-16 bg-signal text-ink">
      <div className="px-6 pb-24 pt-20 md:px-10">
        <RiseIn>
          <h2 className="max-w-[14ch] text-[clamp(2.6rem,6.5vw,6rem)] font-semibold leading-[1.02] tracking-[-0.03em]">
            Give the goal. Keep the keys.
          </h2>
        </RiseIn>
        <RiseIn delay={0.08}>
          <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-ink/80">
            Perago runs on BSC Testnet today. Connect a wallet, set your policy,
            sign one mandate, and watch it carry through to a public receipt.
          </p>
        </RiseIn>
        <RiseIn delay={0.14}>
          <div className="mt-10 flex flex-wrap items-stretch gap-4">
            <Link
              href="/app"
              className="group pressable flex items-center gap-4 whitespace-nowrap bg-ink px-7 py-4 text-paper hover:bg-panel"
            >
              Open the console
              <span
                aria-hidden
                className="arrow font-mono group-hover:translate-x-1"
              >
                &#8594;
              </span>
            </Link>
            <Link
              href="/faucet"
              className="group pressable flex items-center gap-3 whitespace-nowrap border border-ink/40 px-7 py-4 text-ink hover:border-ink"
            >
              Get test tBNB
              <span
                aria-hidden
                className="arrow font-mono group-hover:translate-x-1"
              >
                &#8594;
              </span>
            </Link>
            <a
              href="https://github.com/Dylansius11/perago"
              target="_blank"
              rel="noreferrer"
              className="group pressable flex items-center gap-3 whitespace-nowrap border border-ink/40 px-7 py-4 text-ink hover:border-ink"
            >
              Read the contracts
              <span
                aria-hidden
                className="arrow font-mono group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              >
                &#8599;
              </span>
            </a>
          </div>
        </RiseIn>
        <p className="mt-16 font-mono text-[11px] uppercase tracking-[0.16em] text-ink/60">
          Your wallet signs. Perago never asks for a seed phrase or a private
          key.
        </p>
      </div>
    </section>
  );
}
