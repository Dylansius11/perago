import type { ReactNode } from "react";

/*
 * Shared primitives: the chain tag and the product caption. Both server
 * components; they set the vocabulary the whole page speaks.
 */

/** Uppercase mono tag for chain-level facts. Sits inline, not as an eyebrow. */
export function ChainTag({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fog">
      {children}
    </span>
  );
}

/** Caption above a block of machine facts. */
export function Caption({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-fog">
      {children}
    </p>
  );
}
