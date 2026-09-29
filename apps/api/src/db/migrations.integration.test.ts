import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { applyMigrations, MIGRATIONS, readMigrations } from "./migrations.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for database integration tests",
  );
}

const sql = postgres(databaseUrl, { max: 2, onnotice: () => {} });

beforeEach(async () => {
  await sql.unsafe("drop schema public cascade; create schema public");
});

afterAll(async () => {
  await sql.end();
});

describe("applyMigrations", () => {
  it("applies the checked-in history once and is a no-op on rerun", async () => {
    expect(await applyMigrations(sql)).toEqual([...MIGRATIONS]);
    expect(await applyMigrations(sql)).toEqual([]);
    const rows = await sql<{ count: string }[]>`
      select count(*)::text as count from schema_migrations
    `;
    expect(rows[0]?.count).toBe(String(MIGRATIONS.length));
  });

  it("refuses an edited migration without applying anything new", async () => {
    const sources = await readMigrations();
    await applyMigrations(sql, sources.slice(0, 2));
    const edited = sources.map((source, index) =>
      index === 1 ? { ...source, sql: `${source.sql}\n-- edited` } : source,
    );
    await expect(applyMigrations(sql, edited)).rejects.toThrow(
      `migration ${MIGRATIONS[1]} changed after it ran`,
    );
    const rows = await sql<{ exists: boolean }[]>`
      select to_regclass('public.faucet_claims') is not null as exists
    `;
    expect(rows[0]?.exists).toBe(false);
  });

  it("refuses a database that ran a migration this checkout lacks", async () => {
    const sources = await readMigrations();
    await applyMigrations(sql, sources.slice(0, 2));
    await expect(applyMigrations(sql, sources.slice(0, 1))).rejects.toThrow(
      `recorded migration ${MIGRATIONS[1]} is not checked in`,
    );
  });
});
