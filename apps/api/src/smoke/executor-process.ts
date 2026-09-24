import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { hashSchema } from "@perago/sdk";
import type { Hex } from "viem";
import { expect } from "vitest";
import { z } from "zod";

/**
 * Runs the real executor process (`apps/executor/src/main.ts`) for the phase
 * smokes. Each process receives only public variables plus its own deployment
 * secrets; every line it prints is collected for the log-hygiene check.
 */

const EXECUTOR_DIR = fileURLToPath(
  new URL("../../../executor/", import.meta.url),
);

/** One worker log line: a JSON object naming its event, plus the fields the smokes read. */
const workerEventSchema = z.looseObject({
  event: z.string(),
  kind: z.string().optional(),
  code: z.string().optional(),
  transactionHash: hashSchema.optional(),
  userOperationHash: hashSchema.nullable().optional(),
});
export type WorkerEvent = z.infer<typeof workerEventSchema>;
export type WorkerRun = { code: number | null; lines: string[] };

export type ExecutorProcessConfig = {
  apiUrl: string;
  /** Repository-relative or absolute `deployments/*.perago.json` path. */
  manifestPath: string;
  executorKey: Hex;
  rpcUrl: string;
  workerToken: string;
  pollMs: number;
  /** Receives every line any process prints. */
  log: string[];
};

/** The inherited environment minus every Perago, database, and planner secret. */
function publicEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith("PERAGO_") && !name.includes("DATABASE"),
    ),
  );
}

export function createExecutorProcesses(config: ExecutorProcessConfig) {
  function start(name: string, mode: "once" | "loop", deferSeconds = 2) {
    const child = spawn(
      process.execPath,
      ["src/main.ts", ...(mode === "once" ? ["--once"] : [])],
      {
        cwd: EXECUTOR_DIR,
        env: {
          ...publicEnvironment(),
          PERAGO_API_URL: config.apiUrl,
          PERAGO_DEPLOYMENT_MANIFEST: config.manifestPath,
          PERAGO_EXECUTOR_DEFER_SECONDS: String(deferSeconds),
          PERAGO_EXECUTOR_KEY: config.executorKey,
          PERAGO_EXECUTOR_POLL_MS: String(config.pollMs),
          PERAGO_EXECUTOR_RPC: config.rpcUrl,
          PERAGO_WORKER_ID: name,
          PERAGO_WORKER_TOKEN: config.workerToken,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const lines: string[] = [];
    const collect = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/u)) {
        if (line.trim() === "") continue;
        lines.push(line);
        config.log.push(line);
      }
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const exited = new Promise<WorkerRun>((resolve) => {
      child.once("exit", (code) => resolve({ code, lines }));
    });
    return { child, exited, lines };
  }

  /** One crash-like run: it performs a single chain-changing step and exits holding its lease. */
  async function step(name: string, deferSeconds = 2): Promise<WorkerRun> {
    const run = start(name, "once", deferSeconds);
    const timer = new AbortController();
    const timeout = delay(180_000, undefined, { signal: timer.signal }).then(
      () => {
        run.child.kill("SIGKILL");
        throw new Error(
          `${name} did not finish:\n${run.lines.slice(-10).join("\n")}`,
        );
      },
    );
    const result = await Promise.race([run.exited, timeout]);
    timer.abort();
    timeout.catch(() => {}); // The aborted timer rejects by design once the run has exited.
    expect(result.code, result.lines.slice(-10).join("\n")).toBe(0);
    return result;
  }

  return { start, step };
}

/** The events a run printed, parsed as the JSON the worker must emit. */
export const events = (run: WorkerRun) =>
  run.lines.map((line) => workerEventSchema.parse(JSON.parse(line)));

export const submitted = (run: WorkerRun) =>
  events(run).filter((line) => line.event === "transaction.submitted");
