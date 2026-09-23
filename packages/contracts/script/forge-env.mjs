// Runs forge with the repository `.env` loaded by Node (`--env-file-if-exists`), so fork
// tests and deployment scripts read RPC URLs and the deployer key without any value
// appearing on a command line or in logs. Forge itself does not load the repository
// root `.env`. Set FORGE_BIN when forge is not on PATH.
import { spawnSync } from "node:child_process";

const result = spawnSync(process.env.FORGE_BIN || "forge", process.argv.slice(2), {
  stdio: "inherit",
  shell: false,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
