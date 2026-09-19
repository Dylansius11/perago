import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Persists a probe report as committed evidence. A run that only prints to a
 * terminal cannot be cited later, so every live probe writes its result under
 * `docs/evidence/` and prints the same payload.
 */
export function writeEvidence(name: string, report: unknown): string {
  const path = fileURLToPath(
    new URL(`../../../../docs/evidence/${name}.json`, import.meta.url),
  );
  const serialized = JSON.stringify(
    report,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${serialized}\n`);
  console.log(serialized);
  return path;
}
