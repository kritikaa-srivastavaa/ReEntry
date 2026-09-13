// One-off preparation for a reviewed local-to-hosted transfer. No remote writes.
import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { parse } from "dotenv";
import pg from "pg";

const root = new URL("../../", import.meta.url);
const env = parse(await readFile(new URL("server/.env", root)));
const source = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)) {
  throw new Error("This backup command accepts only a local source database.");
}
const directory = new URL(".reentry-dev/backups/", root);
await mkdir(directory, { recursive: true });
const filename = `reentry-local-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`;
const destination = fileURLToPath(new URL(filename, directory));
const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
try {
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const snapshot = (
    await client.query("SELECT pg_export_snapshot() AS snapshot")
  ).rows[0].snapshot;
  const counts = {};
  for (const table of [
    "users",
    "work_items",
    "checklist_items",
    "resources",
    "sessions",
    "v1_imports",
    "create_receipts",
    "work_checkpoints",
  ]) {
    const exists = (
      await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [
        `public.${table}`,
      ])
    ).rows[0].present;
    if (exists)
      counts[table] = Number(
        (await client.query(`SELECT count(*) FROM public.${table}`)).rows[0]
          .count,
      );
  }
  const executable = process.env.POSTGRES_BIN
    ? join(process.env.POSTGRES_BIN, "pg_dump")
    : "pg_dump";
  await new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "--no-password",
        `--snapshot=${snapshot}`,
        `--file=${destination}`,
      ],
      {
        env: {
          ...process.env,
          PGHOST: source.hostname,
          PGPORT: source.port || "5432",
          PGUSER: decodeURIComponent(source.username),
          PGPASSWORD: decodeURIComponent(source.password),
          PGDATABASE: decodeURIComponent(source.pathname.slice(1)),
          PGCONNECT_TIMEOUT: "10",
        },
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    // Do not echo PostgreSQL diagnostics: connection errors may include secrets.
    child.stderr.resume();
    child.once("error", () =>
      reject(
        new Error("Could not start pg_dump. Check PostgreSQL tools on PATH."),
      ),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Local backup failed; no transfer has occurred.")),
    );
  });
  await client.query("COMMIT");
  const bytes = (await stat(destination)).size;
  if (!bytes) throw new Error("Backup is empty.");
  await writeFile(
    `${destination}.json`,
    JSON.stringify(
      { createdAt: new Date().toISOString(), counts, bytes },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { backup: `.reentry-dev/backups/${filename}`, counts, bytes },
      null,
      2,
    ),
  );
} catch {
  console.error(
    "Could not complete local backup. Check that the local database is running; source data is unchanged.",
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
