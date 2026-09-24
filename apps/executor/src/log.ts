export type LogLevel = "info" | "warn" | "error";

export type Logger = {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
};

const REDACTED = "[REDACTED]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Plain, bounded facts about an error; never its request body or stack. */
export function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: String(error).slice(0, 300) };
  const short =
    "shortMessage" in error && typeof error.shortMessage === "string"
      ? error.shortMessage
      : error.message;
  return { error: error.name, message: short.slice(0, 300) };
}

/**
 * One JSON line per event. Every configured secret - the executor key with or
 * without its `0x` prefix, the worker token, and the RPC URL, which may embed a
 * provider key - is replaced before the line leaves the process, whatever
 * field or nested error it hides in.
 */
export function createLogger(
  secrets: readonly string[],
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Logger {
  const patterns = secrets
    .filter((secret) => secret.length >= 8)
    .flatMap((secret) =>
      secret.startsWith("0x") ? [secret, secret.slice(2)] : [secret],
    )
    .sort((left, right) => right.length - left.length)
    .map((secret) => new RegExp(escapeRegExp(secret), "giu"));

  function emit(level: LogLevel, event: string, fields = {}) {
    let line = JSON.stringify(
      { at: new Date().toISOString(), level, event, ...fields },
      (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
    );
    for (const pattern of patterns) line = line.replace(pattern, REDACTED);
    write(line);
  }

  return {
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}
