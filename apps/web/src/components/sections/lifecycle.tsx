import { RiseIn, Unveil } from "@/components/motion/reveal";
import { Caption } from "@/components/primitives";

/*
 * The lifecycle section. Nine cells on a 6x2 grid: four step blocks on paper,
 * a photo cell, four step blocks on ink. Bento rhythm without a repeated
 * card type. Each step is one product fact, two lines of copy, and a mono
 * spec line.
 */
const STEPS: readonly [
  StepData,
  StepData,
  StepData,
  StepData,
  StepData,
  StepData,
] = [
  {
    n: "01",
    title: "State the goal",
    copy: "One sentence in. The planner proposes a typed plan and explains it. You have not signed anything yet.",
    spec: "TaskIntent",
  },
  {
    n: "02",
    title: "The policy answers first",
    copy: "Deterministic code intersects the plan with your standing limits. A conflict is a structured rejection, every rule shown.",
    spec: "WalletPolicy",
  },
  {
    n: "03",
    title: "Simulated before you sign",
    copy: "The exact compiled action runs against a recorded block. Balances before and after, quoted at that block.",
    spec: "SimulationResult",
  },
  {
    n: "04",
    title: "One signature, one use",
    copy: "An EIP-712 mandate binds owner, executor, chain, nonce, expiry, spend bounds, recipient, and the verified outcome.",
    spec: "TaskMandate",
  },
  {
    n: "05",
    title: "Executed inside the fence",
    copy: "The executor may optimize only within the mandate. The call path is committed; nothing outside it is callable.",
    spec: "Executor",
  },
  {
    n: "06",
    title: "Payment follows proof",
    copy: "A deterministic verifier checks the postcondition before any agent payment settles. Receipts stay public.",
    spec: "ExecutionReceipt",
  },
];

type StepData = {
  n: string;
  title: string;
  copy: string;
  spec: string;
};

export function Lifecycle() {
  return (
    <section id="mandate" className="scroll-mt-16 border-b border-ruleinvert">
      <SectionHeader />
      {/*
       * Four columns, two rows, seven cells: the tree photograph spans both
       * rows in the last column so no slot is left empty. Reading order stays
       * 01 through 06 for assistive tech; the photograph is decorative and
       * sits after step 03 in the DOM.
       */}
      <div className="grid md:grid-cols-4">
        <StepCell data={STEPS[0]} />
        <StepCell data={STEPS[1]} />
        <StepCell data={STEPS[2]} dark />
        <PhotoCell />
        <StepCell data={STEPS[3]} />
        <StepCell data={STEPS[4]} dark />
        <StepCell data={STEPS[5]} tail />
      </div>
    </section>
  );
}

function SectionHeader() {
  return (
    <div className="border-b border-rule px-6 py-12 md:px-10">
      <RiseIn>
        <h2 className="max-w-[16ch] text-4xl font-semibold tracking-[-0.03em] text-ink md:text-6xl">
          A mandate is a fence, not a feeling.
        </h2>
        <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-fog">
          Six steps between a sentence and a settled outcome. Each one is a
          contract fact you can read before it happens.
        </p>
      </RiseIn>
    </div>
  );
}

type StepProps = {
  data: StepData;
  dark?: boolean;
  tail?: boolean;
};

function StepCell({ data, dark, tail }: StepProps) {
  const { n, title, copy, spec } = data;
  const surface = dark
    ? "rain bg-ink text-paper"
    : tail
      ? "bg-signal text-ink"
      : "bg-paper text-ink";
  const ruleColor = dark ? "border-ruleinvert" : "border-rule";
  const numColor = dark ? "text-paper/40" : tail ? "text-ink/60" : "text-fog";
  const copyColor = dark ? "text-paper/70" : "text-fog";
  const specColor = dark ? "text-phos/80" : tail ? "text-ink/70" : "text-fog";

  return (
    <RiseIn
      className={`min-h-[280px] border-l border-t ${ruleColor} ${surface} p-6 md:p-8`}
    >
      <div className="flex h-full flex-col justify-between gap-10">
        <div>
          <span className={`font-mono text-[12px] ${numColor}`}>{n}</span>
          <h3 className="mt-6 text-2xl font-semibold tracking-[-0.02em] md:text-[1.7rem]">
            {title}
          </h3>
          <p className={`mt-3 max-w-[38ch] leading-relaxed ${copyColor}`}>
            {copy}
          </p>
        </div>
        <span
          className={`font-mono text-[11px] uppercase tracking-[0.16em] ${specColor}`}
        >
          {spec}
        </span>
      </div>
    </RiseIn>
  );
}

function PhotoCell() {
  return (
    <Unveil className="relative min-h-[220px] overflow-hidden border-l border-t border-rule bg-panel md:row-span-2">
      {/* Wood-cut node illustration: authored SVG line art on panel green. */}
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 h-full w-full text-paper/25"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
      >
        <circle cx="100" cy="100" r="78" />
        <circle cx="100" cy="100" r="52" />
        <circle cx="100" cy="100" r="26" />
        {[...Array(24)].map((_, i) => {
          const a = (i * Math.PI) / 12;
          return (
            <line
              key={a}
              x1={100 + Math.cos(a) * 78}
              y1={100 + Math.sin(a) * 78}
              x2={100 + Math.cos(a) * 26}
              y2={100 + Math.sin(a) * 26}
            />
          );
        })}
        <circle cx="100" cy="100" r="4" fill="currentColor" stroke="none" />
      </svg>
      <div className="relative flex h-full items-end p-6">
        <Caption>The one-use knot. Tied once, cut once.</Caption>
      </div>
    </Unveil>
  );
}
