"use client";

import { motion, useReducedMotion, useAnimate } from "motion/react";
import { useEffect, useRef } from "react";

/*
 * Hero. Split world: paper carries the promise, ink carries the proof.
 * Left: masked line-by-line headline reveal. Right: a looping, typed
 * lifecycle of one illustrative mandate on the terminal surface.
 */

const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

const HEADLINE_LINES = ["Give the", "goal, not", "the wallet."];

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export function Hero() {
  const reduced = useReducedMotion();

  return (
    <section className="relative border-b border-ruleinvert pt-16">
      <div className="mx-auto grid max-w-[1560px] md:grid-cols-12">
        {/* Left: the promise */}
        <div className="flex min-h-[82dvh] flex-col justify-between border-b border-ruleinvert px-6 pb-10 pt-10 md:col-span-7 md:min-h-0 md:border-b-0 md:border-r md:pr-10">
          <div className="flex items-center gap-3 pt-2">
            <span
              aria-hidden
              className="size-2 bg-signal motion-safe:animate-blink"
            />
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fog">
              Intent, carried through &middot; BSC Testnet
            </span>
          </div>

          <h1 className="py-14 text-[clamp(3.4rem,9vw,8.25rem)] leading-[0.94] font-semibold tracking-[-0.03em] md:py-10">
            {HEADLINE_LINES.map((line, i) => (
              <span key={line} className="block overflow-hidden pb-[0.06em]">
                {reduced ? (
                  <span className="block">{line}</span>
                ) : (
                  <motion.span
                    className="block"
                    initial={{ y: "112%" }}
                    animate={{ y: "0%" }}
                    transition={{
                      duration: 0.95,
                      ease: EASE,
                      delay: 0.15 + i * 0.11,
                    }}
                  >
                    {line}
                  </motion.span>
                )}
              </span>
            ))}
          </h1>

          {reduced ? (
            <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
              <p className="max-w-[42ch] text-lg leading-relaxed text-fog">
                One EIP-712 mandate. Bounded spend, one use, deterministic
                verification. When the task ends, the authority ends.
              </p>
              <HeroActions />
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.55 }}
              className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between"
            >
              <p className="max-w-[42ch] text-lg leading-relaxed text-fog">
                One EIP-712 mandate. Bounded spend, one use, deterministic
                verification. When the task ends, the authority ends.
              </p>
              <HeroActions />
            </motion.div>
          )}
        </div>

        {/* Right: the proof */}
        <div className="rain relative bg-ink px-6 py-10 text-paper md:col-span-5 md:pl-10">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper/50">
              One mandate, start to finish
            </span>
            <span
              aria-hidden
              className="size-2 bg-phos motion-safe:animate-blink"
            />
          </div>
          <ReceiptSequence />
          <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.16em] text-paper/40">
            An illustrative lifecycle. Real receipts live onchain.
          </p>
        </div>
      </div>
    </section>
  );
}

function HeroActions() {
  return (
    <div className="flex items-stretch">
      <a
        href="#access"
        className="group flex items-center gap-4 bg-ink px-7 py-4 text-paper transition-colors duration-200 hover:bg-signal hover:text-ink active:scale-[0.98] motion-safe:transition-transform"
      >
        Start a mandate
        <span
          aria-hidden
          className="font-mono transition-transform duration-200 group-hover:translate-x-1"
        >
          &#8594;
        </span>
      </a>
      <a
        href="#mandate"
        className="group flex items-center gap-3 border border-rule px-7 py-4 text-ink transition-colors duration-200 hover:border-ink hover:bg-ink hover:text-paper"
      >
        How it works
        <span
          aria-hidden
          className="font-mono text-fog transition-colors duration-200 group-hover:text-paper group-hover:translate-x-1"
        >
          &#8594;
        </span>
      </a>
    </div>
  );
}
/* ------------------------------------------------------------------
 * Lifecycle sequence
 * ------------------------------------------------------------------ */

type Phase = {
  label: string;
  detail: string;
  status: string;
  tone: "run" | "pass" | "done";
};

const PHASES: Phase[] = [
  { label: "goal", detail: '"Swap 0.05 BNB to USDT"', status: "STATED", tone: "run" },
  { label: "policy", detail: "spend <= 0.05 BNB, slippage <= 100 bps", status: "PASS", tone: "pass" },
  { label: "plan", detail: "PancakeSwap V3, 500 pool", status: "PASS", tone: "pass" },
  { label: "simulation", detail: "block 47,218,551", status: "PROOF", tone: "pass" },
  { label: "mandate", detail: "EIP-712, nonce 0007, one use", status: "SIGNED", tone: "pass" },
  { label: "execution", detail: "UserOperation 0x9d...e2f1", status: "PERF", tone: "pass" },
  { label: "receipt", detail: "verifier 0x7c...41aa", status: "SUCCEEDED", tone: "done" },
];

const TONE_COLOR: Record<Phase["tone"], string> = {
  run: "text-statuspending",
  pass: "text-phos",
  done: "text-signal",
};

function ReceiptSequence() {
  const reduced = useReducedMotion();
  const [scope, animate] = useAnimate();
  const started = useRef(false);

  useEffect(() => {
    if (reduced || started.current) return;
    started.current = true;

    let cancelled = false;

    const run = async () => {
      while (!cancelled) {
        // Reveal each phase line in order.
        for (let i = 0; i < PHASES.length; i++) {
          if (cancelled) return;
          await animate(
            `[data-phase="${i}"]`,
            { opacity: [0, 1], y: [10, 0] },
            { duration: 0.4, ease: EASE },
          );
          await delay(380);
        }
        // Blink the terminal status, hold, then reset.
        await animate(
          "[data-terminal]",
          { opacity: [1, 0.35, 1] },
          { duration: 0.9, ease: "linear" },
        );
        await delay(3200);
        if (cancelled) return;
        await animate(
          "[data-phase], [data-terminal]",
          { opacity: 0 },
          { duration: 0.35, ease: "easeOut", delay: 0.02 },
        );
        await delay(500);
        animate("[data-phase]", { y: 10 }, { duration: 0 });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [animate, reduced]);

  return (
    <div ref={scope} className="mt-8 font-mono text-[13px] leading-loose">
      {PHASES.map((phase, i) => (
        <div
          key={phase.label}
          data-phase={i}
          className="flex items-baseline gap-3 border-b border-ruleinvert py-2.5"
          style={{ opacity: reduced ? 1 : 0 }}
        >
          <span className="w-24 shrink-0 text-paper/50">{phase.label}</span>
          <span className="min-w-0 flex-1 truncate text-paper/80">
            {phase.detail}
          </span>
          <span className={`shrink-0 text-[12px] ${TONE_COLOR[phase.tone]}`}>
            {phase.status}
          </span>
        </div>
      ))}
      <div
        data-terminal
        className="flex items-baseline gap-3 pt-4"
        style={{ opacity: reduced ? 1 : 0 }}
      >
        <span className="text-paper/50">&gt;</span>
        <span className={TONE_COLOR.done}>AUTHORITY ENDED</span>
        <span aria-hidden className="text-signal motion-safe:animate-blink">
          &#9612;
        </span>
      </div>
    </div>
  );
}
