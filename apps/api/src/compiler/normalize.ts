import type {
  Address,
  CatalogAdapter,
  ProtocolCatalog,
  StakeCandidate,
  SwapCandidate,
} from "@perago/sdk";

export type NormalizedAction = {
  adapter: CatalogAdapter;
  /** Exact base units, or null when the decimal has more places than the token. */
  inputAmount: bigint | null;
  inputDecimals: number;
  inputToken: Address;
  kind: "SWAP" | "STAKE";
  maxSlippageBps: number | null;
  outputToken: Address | null;
  recipient: Address | null;
  requestedAmount: string;
};

/**
 * Converts a plain decimal to base units without rounding. Excess precision
 * returns null so the amount rule rejects it instead of truncating it.
 */
export function toBaseUnits(amount: string, decimals: number): bigint | null {
  const [whole = "0", fraction = ""] = amount.split(".");
  const significant = fraction.replace(/0+$/u, "");
  if (significant.length > decimals) return null;
  return BigInt(whole + significant.padEnd(decimals, "0"));
}

/**
 * Resolves catalog vocabulary to pinned addresses. A symbol or adapter the
 * catalog does not know, or an adapter of the wrong kind, means the model left
 * the closed vocabulary: the output is invalid, not merely policy-failing.
 */
export function normalizeCandidate(
  candidate: SwapCandidate | StakeCandidate,
  catalog: ProtocolCatalog,
): NormalizedAction | null {
  const adapter = catalog.adapters.find(
    (entry) => entry.id === candidate.adapterId,
  );
  const input = catalog.tokens.find(
    (token) => token.symbol === candidate.inputSymbol,
  );
  if (!adapter || adapter.kind !== candidate.kind || !input) return null;

  let outputToken: Address | null = null;
  if (candidate.kind === "SWAP") {
    const output = catalog.tokens.find(
      (token) => token.symbol === candidate.outputSymbol,
    );
    if (!output) return null;
    outputToken = output.address;
  }

  return {
    adapter,
    inputAmount: toBaseUnits(candidate.inputAmount, input.decimals),
    inputDecimals: input.decimals,
    inputToken: input.address,
    kind: candidate.kind,
    maxSlippageBps: candidate.maxSlippageBps,
    outputToken,
    recipient: candidate.recipient,
    requestedAmount: candidate.inputAmount,
  };
}
