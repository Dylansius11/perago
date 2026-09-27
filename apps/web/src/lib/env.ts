/*
 * Public build-time settings. Next inlines `NEXT_PUBLIC_*` values, so each is
 * read by its literal name. Nothing here is a secret: the API origin and the
 * chain-97 RPC the console reads through.
 */

function origin(value: string | undefined, fallback: string): string {
  const url = new URL(value && value.length > 0 ? value : fallback);
  return url.toString().replace(/\/$/u, "");
}

export const API_URL = origin(
  process.env.NEXT_PUBLIC_PERAGO_API_URL,
  "http://127.0.0.1:8787",
);

/** Empty means the viem chain default for BSC Testnet. */
export const RPC_URL: string | undefined =
  process.env.NEXT_PUBLIC_PERAGO_RPC_URL || undefined;
