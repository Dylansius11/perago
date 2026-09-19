import { RiseIn } from "@/components/motion/reveal";
import { Caption } from "@/components/primitives";

/*
 * The mandate anatomy: a full-width specimen of the signed object. Six
 * binding fields on paper left, the signature block on ink right. The
 * display is a static, honest illustration: real field names from the
 * contract surface, illustrative values, labeled as such.
 */

const BINDINGS: Array<[string, string, string]> = [
  ["owner", "0x2E42…c381", "your key, your account"],
  ["account", "0x2863…57E2", "ERC-4337 smart account"],
  ["executor", "0x9dC0…b2a4", "allowlisted worker"],
  ["chain", "97 testnet", "chain id bound in EIP-712"],
  ["nonce", "0007", "consumed once, forever"],
  ["expiry", "2026-09-19 12:00Z", "authority ends with the clock"],
];

const BOUNDS: Array<[string, string]> = [
  ["asset in", "0.05 BNB max"],
  ["asset out", "USDT, min out 29.80"],
  ["recipient", "SELF"],
  ["protocol", "PancakeSwap V3"],
  ["slippage", "100 bps"],
  ["postcondition", "minOut verified onchain"],
];

export function Anatomy() {
  return (
    <section className="border-b border-ruleinvert bg-paper">
      <div className="grid md:grid-cols-12">
        <div className="px-6 py-16 md:col-span-7 md:px-10">
          <RiseIn>
            <h2 className="max-w-[18ch] text-4xl font-semibold tracking-[-0.03em] md:text-6xl">
              What you sign is what can happen.
            </h2>
            <p className="mt-5 max-w-[54ch] text-lg leading-relaxed text-fog">
              One typed object carries every limit. There is no second place
              where authority can hide.
            </p>
          </RiseIn>

          <RiseIn delay={0.1} className="mt-12">
            <Caption>Six bindings</Caption>
            <div className="divide-y divide-rule border-y border-rule">
              {BINDINGS.map(([field, value, note]) => (
                <div
                  key={field}
                  className="grid grid-cols-[7rem_1fr] items-baseline gap-x-6 py-3.5 md:grid-cols-[9rem_12rem_1fr]"
                >
                  <span className="font-mono text-[13px] text-signal-ink">
                    {field}
                  </span>
                  <span className="font-mono text-[13px] text-ink">{value}</span>
                  <span className="col-span-2 mt-1 text-sm text-fog md:col-span-1 md:mt-0">
                    {note}
                  </span>
                </div>
              ))}
            </div>
          </RiseIn>

          <RiseIn delay={0.15} className="mt-10">
            <Caption>Six bounds</Caption>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-3">
              {BOUNDS.map(([k, v]) => (
                <div key={k} className="border-t border-rule pt-3">
                  <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-fog">
                    {k}
                  </div>
                  <div className="mt-1 text-[15px] text-ink">{v}</div>
                </div>
              ))}
            </div>
          </RiseIn>

          <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.16em] text-fog">
            Values are illustrative. Field names are the contract surface.
          </p>
        </div>

        <div className="rain border-t border-ruleinvert bg-ink px-6 py-16 text-paper md:col-span-5 md:border-l md:border-t-0 md:px-10">
          <RiseIn>
            <Caption>The signature</Caption>
            <p className="max-w-[38ch] text-lg leading-relaxed text-paper/80">
              EIP-712, typed and human-readable. Your wallet shows you the same
              fields this page does, because both render one schema.
            </p>
            <div className="mt-8 font-mono text-[13px] leading-loose text-paper/70">
              <div className="text-phos">PeragoTaskMandate(</div>
              <div className="pl-4">owner, account, executor,</div>
              <div className="pl-4">chainId, nonce, expiry,</div>
              <div className="pl-4">policyHash, planHash,</div>
              <div className="pl-4">simulationHash, actionHash,</div>
              <div className="pl-4">postconditionHash, jobBinding,</div>
              <div className="pl-4">assetIn, assetOut,</div>
              <div className="pl-4">maxInput, minOutput,</div>
              <div className="pl-4">recipient, adapter, selector,</div>
              <div className="pl-4">window, ownerEpoch, version</div>
              <div className="text-phos">)</div>
            </div>
            <div className="mt-10 border-t border-ruleinvert pt-6">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper/50">
                22 fields. One use. Then nothing.
              </span>
            </div>
          </RiseIn>
        </div>
      </div>
    </section>
  );
}
