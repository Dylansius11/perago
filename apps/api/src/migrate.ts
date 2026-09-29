import postgres from "postgres";

import { applyMigrations } from "./db/migrations.js";

/**
 * Applies checked-in migrations to PERAGO_DATABASE_URL. Non-destructive: it
 * never drops a schema, so it is the only migration path for hosted databases.
 */
const url = process.env.PERAGO_DATABASE_URL;
if (!url) throw new Error("PERAGO_DATABASE_URL is required");

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const applied = await applyMigrations(sql);
  const [row] = await sql<{ server_version: string }[]>`show server_version`;
  console.log(
    JSON.stringify({
      event: "db.migrated",
      applied,
      serverVersion: row?.server_version ?? null,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      event: "db.migration_failed",
      message: error instanceof Error ? error.message : "unknown error",
    }),
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
