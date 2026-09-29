import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Sql } from "postgres";

/** Checked-in schema history, applied strictly in this order. */
export const MIGRATIONS = [
  "0000_constrained_lifecycle.sql",
  "0001_wallet_auth_policy_lifecycle.sql",
  "0002_task_compilation.sql",
  "0003_mandate_signing.sql",
  "0004_execution_worker.sql",
  "0005_chain_event_reorg_versions.sql",
  "0006_commerce_settlement.sql",
  "0007_faucet_claims.sql",
] as const;

const LOCK_KEY = "perago.schema_migrations";

export type MigrationSource = { name: string; sql: string };

export async function readMigrations(
  names: readonly string[] = MIGRATIONS,
): Promise<MigrationSource[]> {
  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(
        new URL(`../../drizzle/${name}`, import.meta.url),
        "utf8",
      ),
    })),
  );
}

/**
 * Applies unapplied migrations in one transaction under an advisory lock and
 * records each file's SHA-256. It never drops or rewrites data: a recorded
 * migration whose file has since changed, or an unknown recorded migration,
 * aborts the whole run before anything is applied.
 */
export async function applyMigrations(
  sql: Sql,
  sources?: readonly MigrationSource[],
): Promise<string[]> {
  const migrations = sources ?? (await readMigrations());
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`;
    await tx`
      create table if not exists schema_migrations (
        name text primary key,
        sha256 bytea not null check (octet_length(sha256) = 32),
        applied_at timestamptz not null default now()
      )
    `;
    const recorded = new Map(
      (
        await tx<{ name: string; sha256: Buffer }[]>`
          select name, sha256 from schema_migrations
        `
      ).map((row) => [row.name, row.sha256]),
    );
    const known = new Set(migrations.map((migration) => migration.name));
    for (const name of recorded.keys()) {
      if (!known.has(name)) {
        throw new Error(`recorded migration ${name} is not checked in`);
      }
    }
    const applied: string[] = [];
    for (const migration of migrations) {
      const digest = createHash("sha256").update(migration.sql).digest();
      const previous = recorded.get(migration.name);
      if (previous) {
        if (applied.length > 0) {
          throw new Error(`migration ${migration.name} ran out of order`);
        }
        if (!previous.equals(digest)) {
          throw new Error(`migration ${migration.name} changed after it ran`);
        }
        continue;
      }
      await tx.unsafe(migration.sql);
      await tx`
        insert into schema_migrations (name, sha256)
        values (${migration.name}, ${digest})
      `;
      applied.push(migration.name);
    }
    return applied;
  });
}
