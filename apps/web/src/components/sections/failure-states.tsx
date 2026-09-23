import { RiseIn } from "@/components/motion/reveal";

/*
 * Failure gallery: what the system does when the world says no. Four real
 * terminal states from the contract surface, each with its reason code and
 * the human sentence the product shows. Status colors come from the
 * terminal palette and appear inside dark panels only.
 */

const FAILURES = [
  {
    code: "STALE_SIMULATION",
    line: "The block moved. Nothing was signed.",
    body: "A quote older than its block is refused before it can reach your wallet. Sign only what was proven.",
    status: "BLOCKED",
    tone: "text-statuspending",
  },
  {
    code: "NONCE_USED",
    line: "This mandate already ended.",
    body: "Authorization consumes the nonce permanently. A replay is rejected by the contract, not by a policy setting.",
    status: "REVERTED",
    tone: "text-statusfail",
  },
  {
    code: "EXPIRED",
    line: "The window closed on its own.",
    body: "Miss the deadline and the mandate is dead, even if you change your mind. Authority that can outlive you is not yours to give.",
    status: "TERMINAL",
    tone: "text-statusfail",
  },
  {
    code: "REVOKED",
    line: "You took it back.",
    body: "While a mandate is still authorized, revocation is one call. After execution begins, the window is immutable and the outcome is final.",
    status: "TERMINAL",
    tone: "text-phos",
  },
] as const;

export function FailureStates() {
  return (
    <section
      id="execution"
      className="scroll-mt-16 border-b border-ruleinvert bg-paper"
    >
      <div className="px-6 py-16 md:px-10">
        <RiseIn>
          <h2 className="max-w-[20ch] text-4xl font-semibold tracking-[-0.03em] md:text-6xl">
            The fence holds when things go wrong.
          </h2>
        </RiseIn>

        <div className="mt-12 grid gap-px border border-ruleinvert bg-ruleinvert md:grid-cols-2">
          {FAILURES.map((f, i) => (
            <RiseIn key={f.code} delay={i * 0.06} className="bg-ink">
              <div className="rain pressable flex h-full flex-col p-8 text-paper hover:bg-panel md:p-10">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper/50">
                    {f.code}
                  </span>
                  <span className={`font-mono text-[11px] ${f.tone}`}>
                    {f.status}
                  </span>
                </div>
                <h3 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">
                  {f.line}
                </h3>
                <p className="mt-3 max-w-[44ch] leading-relaxed text-paper/70">
                  {f.body}
                </p>
              </div>
            </RiseIn>
          ))}
        </div>

        <RiseIn delay={0.1} className="mt-10">
          <p className="max-w-[60ch] text-lg leading-relaxed text-fog">
            No generic error screen. Every terminal state carries its reason
            code and its sentence, because a refusal you can read is the product
            working.
          </p>
        </RiseIn>
      </div>
    </section>
  );
}
