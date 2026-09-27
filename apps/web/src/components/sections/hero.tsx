"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";

/*
 * Hero. Split world: paper carries the promise, ink carries the proof.
 * Left: masked line-by-line headline reveal. Right: a looping lifecycle of
 * one illustrative mandate, played like a terminal: each row starts as RUN
 * and settles to its verdict, and a hairline under the log measures how far
 * the mandate has travelled.
 */

const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

const HEADLINE_LINES = ["Give the", "goal, not", "the wallet."];

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export function Hero() {
  return (
    <section className="relative border-b border-ruleinvert pt-16">
      <div className="grid grid-cols-1 md:grid-cols-12">
        {/* Left: the promise */}
        <div className="flex min-h-[76dvh] flex-col justify-between border-b border-ruleinvert px-6 pb-10 pt-10 md:col-span-7 md:min-h-0 md:border-b-0 md:border-r md:pr-10">
          <div className="flex items-center gap-3 pt-2">
            <span
              aria-hidden
              className="size-2 bg-signal motion-safe:animate-blink"
            />
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fog">
              Intent, carried through &middot; BSC Testnet
            </span>
          </div>

          <h1 className="py-12 text-[clamp(3.2rem,8.4vw,7.75rem)] leading-[0.94] font-semibold tracking-[-0.03em] md:py-8">
            {HEADLINE_LINES.map((line, i) => (
              <span key={line} className="block overflow-hidden pb-[0.06em]">
                <motion.span
                  className="block"
                  data-reveal
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
              </span>
            ))}
          </h1>

          <HeroFoot />
        </div>

        {/* Right: the proof */}
        <div className="rain relative flex flex-col bg-ink px-6 py-10 text-paper md:col-span-5 md:pl-10">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper/50">
              One mandate, start to finish
            </span>
            <span
              aria-hidden
              className="size-2 bg-phos motion-safe:animate-blink"
            />
          </div>
          <MandateLog />
          <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.16em] text-paper/40">
            An illustrative lifecycle. Real receipts live onchain.
          </p>
        </div>
      </div>
    </section>
  );
}

function HeroFoot() {
  const inner = (
    <>
      <p className="max-w-[42ch] text-lg leading-relaxed text-fog">
        One EIP-712 mandate. Bounded spend, one use, deterministic verification.
        When the task ends, the authority ends.
      </p>
      <HeroActions />
    </>
  );
  const className =
    "flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between";

  return (
    <motion.div
      data-reveal
      className={className}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: EASE, delay: 0.55 }}
    >
      {inner}
    </motion.div>
  );
}

function HeroActions() {
  return (
    <div className="flex flex-wrap items-stretch">
      <Link
        href="/app"
        className="group pressable flex items-center gap-4 whitespace-nowrap bg-ink px-7 py-4 text-paper hover:bg-signal hover:text-ink"
      >
        Open the console
        <span aria-hidden className="arrow font-mono group-hover:translate-x-1">
          &#8594;
        </span>
      </Link>
      <a
        href="#mandate"
        className="group pressable flex items-center gap-3 whitespace-nowrap border border-rule px-7 py-4 text-ink hover:border-ink hover:bg-ink hover:text-paper"
      >
        How it works
        <span
          aria-hidden
          className="arrow font-mono text-fog group-hover:translate-y-0.5 group-hover:text-paper"
        >
          &#8595;
        </span>
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------
 * Mandate log
 * ------------------------------------------------------------------ */

type Phase = {
  label: string;
  detail: string;
  status: string;
  tone: "pass" | "done";
};

/*
 * Field names and the order are the product's; values are illustrative and
 * labeled as such under the panel. The pair, venue, and pool are the ones
 * Perago's swap adapter is pinned to on BSC Testnet.
 */
const PHASES: Phase[] = [
  {
    label: "goal",
    detail: '"Swap 0.01 WBNB for CAKE"',
    status: "STATED",
    tone: "pass",
  },
  {
    label: "policy",
    detail: "13 rules, input <= 0.05 WBNB",
    status: "PASS",
    tone: "pass",
  },
  {
    label: "plan",
    detail: "PancakeSwap V3, WBNB/CAKE",
    status: "COMPILED",
    tone: "pass",
  },
  {
    label: "simulation",
    detail: "pinned block, min out bound",
    status: "PASS",
    tone: "pass",
  },
  {
    label: "mandate",
    detail: "EIP-712, one nonce, 30 min",
    status: "SIGNED",
    tone: "pass",
  },
  {
    label: "execution",
    detail: "session UserOperation",
    status: "PERFORMED",
    tone: "pass",
  },
  {
    label: "receipt",
    detail: "verifier checked min out",
    status: "SUCCEEDED",
    tone: "done",
  },
];

const LAST = PHASES.length - 1;

type LogState = { shown: number; settled: number; ended: boolean };

/* The server renders the finished log, so it reads without JavaScript. */
const FINISHED: LogState = { shown: LAST, settled: LAST, ended: true };

/*
 * The log replays itself only when motion is welcome: it clears, then each
 * row arrives as RUN and settles to its verdict, and the closing line holds
 * before the next pass. Reduced motion keeps the finished log.
 */
function MandateLog() {
  const reduced = useReducedMotion();
  const [state, setState] = useState<LogState>(FINISHED);

  useEffect(() => {
    if (reduced) {
      setState(FINISHED);
      return;
    }
    let cancelled = false;
    const run = async () => {
      await delay(1_400);
      while (!cancelled) {
        setState({ shown: -1, settled: -1, ended: false });
        await delay(520);
        for (let i = 0; i <= LAST && !cancelled; i++) {
          setState({ shown: i, settled: i - 1, ended: false });
          await delay(420);
          setState({ shown: i, settled: i, ended: false });
          await delay(200);
        }
        if (cancelled) return;
        setState(FINISHED);
        await delay(4_200);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [reduced]);

  const progress = state.ended ? 1 : (state.settled + 1) / PHASES.length;

  return (
    <div className="mt-8 flex flex-1 flex-col font-mono text-[13px] leading-loose">
      <ol aria-label="Illustrative mandate lifecycle">
        {PHASES.map((phase, i) => {
          const visible = i <= state.shown;
          const settled = i <= state.settled;
          return (
            <motion.li
              key={phase.label}
              className="flex items-baseline gap-3 border-b border-ruleinvert py-2.5"
              initial={false}
              animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 8 }}
              transition={{ duration: 0.32, ease: EASE }}
            >
              <span className="w-24 shrink-0 text-paper/50">{phase.label}</span>
              <span className="min-w-0 flex-1 truncate text-paper/80">
                {phase.detail}
              </span>
              <span
                className={`shrink-0 text-[12px] ${
                  settled
                    ? phase.tone === "done"
                      ? "text-signal"
                      : "text-phos"
                    : "text-statuspending"
                }`}
              >
                {settled ? phase.status : "RUN"}
              </span>
            </motion.li>
          );
        })}
      </ol>

      <div className="relative mt-4 h-px w-full bg-ruleinvert" aria-hidden>
        <motion.div
          className="absolute inset-y-0 left-0 w-full origin-left bg-signal"
          initial={false}
          animate={{ scaleX: progress }}
          transition={{ duration: 0.42, ease: EASE }}
        />
      </div>

      <motion.div
        className="flex items-baseline gap-3 pt-4"
        initial={false}
        animate={{ opacity: state.ended ? 1 : 0 }}
        transition={{ duration: 0.3, ease: EASE }}
      >
        <span className="text-paper/50">&gt;</span>
        <span className="text-signal">AUTHORITY ENDED</span>
        <span aria-hidden className="text-signal motion-safe:animate-blink">
          &#9612;
        </span>
      </motion.div>
    </div>
  );
}
