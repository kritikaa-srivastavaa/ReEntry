// Run without arguments to inspect. --apply copies into an EMPTY hosted database.
// Never copies sessions/secrets, resets schemas, or overwrites existing rows.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parse } from "dotenv";
import pg from "pg";
// Preserve PostgreSQL timestamp precision rather than rounding through JS Date.
pg.types.setTypeParser(1184, (value) => value);

const root = new URL("../../", import.meta.url);
const tables = {
  users: ["id", "email", "password_hash", "created_at", "updated_at"],
  work_items: [
    "id",
    "user_id",
    "title",
    "category",
    "goal",
    "status",
    "where_i_left_off",
    "next_action",
    "created_at",
    "updated_at",
  ],
  checklist_items: [
    "id",
    "work_item_id",
    "text",
    "completed",
    "position",
    "created_at",
    "updated_at",
  ],
  resources: ["id", "work_item_id", "title", "url", "created_at", "updated_at"],
  v1_imports: ["user_id", "source_id", "work_item_id", "created_at"],
  create_receipts: [
    "user_id",
    "request_id",
    "payload_hash",
    "work_item_id",
    "created_at",
  ],
};
let source, target;
let stage = "configuration";
let committed = false;
try {
  const local = parse(await readFile(new URL("server/.env", root)));
  const remote = parse(
    await readFile(new URL("server/.env.transfer.local", root)),
  );
  const from = new URL(local.DATABASE_URL);
  const to = new URL(remote.TARGET_DATABASE_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(from.hostname))
    throw new Error("source");
  if (
    !to.hostname.endsWith(".render.com") ||
    !["postgres:", "postgresql:"].includes(to.protocol)
  )
    throw new Error("target");
  // Explicit TLS configuration avoids URL sslmode overriding certificate checks.
  source = new pg.Client({
    connectionString: local.DATABASE_URL,
    connectionTimeoutMillis: 10000,
  });
  target = new pg.Client({
    host: to.hostname,
    port: Number(to.port || 5432),
    database: decodeURIComponent(to.pathname.slice(1)),
    user: decodeURIComponent(to.username),
    password: decodeURIComponent(to.password),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15000,
  });
  stage = "source connection";
  await source.connect();
  stage =
    "V2-only transfer compatibility check (V3 requires a reviewed full backup/restore)";
  if (
    (
      await source.query(
        "SELECT to_regclass('public.work_checkpoints') IS NOT NULL AS present",
      )
    ).rows[0].present
  )
    throw new Error("Refusing to omit V3 history and workspace metadata");
  stage = "target TLS connection";
  await target.connect();
  await source.query("SET TIME ZONE 'UTC'");
  await target.query("SET TIME ZONE 'UTC'");
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const snapshot = {};
  const counts = {};
  stage = "schema and counts";
  for (const [table, columns] of Object.entries(tables)) {
    const sourceExists = (
      await source.query("SELECT to_regclass($1) IS NOT NULL AS present", [
        `public.${table}`,
      ])
    ).rows[0].present;
    const targetExists = (
      await target.query("SELECT to_regclass($1) IS NOT NULL AS present", [
        `public.${table}`,
      ])
    ).rows[0].present;
    if ((!sourceExists || !targetExists) && table !== "create_receipts")
      throw new Error("schema");
    snapshot[table] = sourceExists
      ? (await source.query(`SELECT ${columns.join(",")} FROM public.${table}`))
          .rows
      : [];
    if (!targetExists && snapshot[table].length)
      throw new Error("Target needs receipt migration before transfer");
    counts[table] = {
      source: snapshot[table].length,
      target: targetExists
        ? Number(
            (await target.query(`SELECT count(*) FROM public.${table}`)).rows[0]
              .count,
          )
        : 0,
      targetExists,
    };
  }
  const targetSessions = Number(
    (await target.query("SELECT count(*) FROM public.sessions")).rows[0].count,
  );
  const targetEmails = new Set(
    (
      await target.query("SELECT lower(email) AS email FROM public.users")
    ).rows.map((row) => row.email),
  );
  const conflicts = snapshot.users.filter((row) =>
    targetEmails.has(row.email.toLowerCase()),
  ).length;
  console.log(
    JSON.stringify(
      {
        counts,
        targetSessions,
        conflictingEmails: conflicts,
        mode: process.argv.includes("--apply") ? "apply" : "inspect",
      },
      null,
      2,
    ),
  );
  if (process.argv.includes("--apply") || process.argv.includes("--rehearse")) {
    if (!snapshot.users.length) throw new Error("No local accounts");
    if (targetSessions || Object.values(counts).some((count) => count.target))
      throw new Error("Target contains data; merge needs review");
    stage = "private source and target backup";
    const backupDir = new URL(".reentry-dev/backups/", root);
    await mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await writeFile(
      new URL(`transfer-source-${stamp}.json`, backupDir),
      JSON.stringify(snapshot),
      { flag: "wx", mode: 0o600 },
    );
    await target.query("BEGIN");
    await target.query("SET LOCAL lock_timeout = '10s'");
    await target.query("SET LOCAL statement_timeout = '30s'");
    const present = Object.keys(tables).filter(
      (table) => counts[table].targetExists,
    );
    await target.query(
      `LOCK TABLE ${[...present, "sessions"].map((table) => `public.${table}`).join(",")} IN SHARE ROW EXCLUSIVE MODE`,
    );
    // Recheck under lock so a concurrent registration cannot be overwritten.
    for (const table of [...present, "sessions"]) {
      if (
        Number(
          (await target.query(`SELECT count(*) FROM public.${table}`)).rows[0]
            .count,
        )
      )
        throw new Error("Target changed during preflight");
    }
    const migrations = (
      await target.query("SELECT * FROM public.schema_migrations ORDER BY name")
    ).rows;
    await writeFile(
      new URL(`transfer-target-before-${stamp}.json`, backupDir),
      JSON.stringify({
        tables: Object.fromEntries(
          [...present, "sessions"].map((table) => [table, []]),
        ),
        schema_migrations: migrations,
      }),
      { flag: "wx", mode: 0o600 },
    );
    stage = "transactional copy and verification";
    for (const table of present) {
      const columns = tables[table];
      for (const row of snapshot[table]) {
        await target.query(
          `INSERT INTO public.${table} (${columns.join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
          columns.map((column) => row[column]),
        );
      }
      const copied = (
        await target.query(`SELECT ${columns.join(",")} FROM public.${table}`)
      ).rows;
      const normalize = (rows) => rows.map((row) => JSON.stringify(row)).sort();
      if (
        JSON.stringify(normalize(copied)) !==
        JSON.stringify(normalize(snapshot[table]))
      )
        throw new Error("Verification mismatch");
    }
    if (process.argv.includes("--rehearse")) {
      await target.query("ROLLBACK");
      console.log(
        "Rehearsal verified every field and rolled back. Target remains unchanged.",
      );
    } else {
      await target.query("COMMIT");
      committed = true;
      await writeFile(
        new URL(`transfer-result-${stamp}.json`, backupDir),
        JSON.stringify(
          {
            committed: true,
            counts: Object.fromEntries(
              Object.entries(counts).map(([name, value]) => [
                name,
                value.source,
              ]),
            ),
            sessionsCopied: false,
            secretChanged: false,
          },
          null,
          2,
        ),
      );
      console.log(
        "Transfer committed. All copied fields, IDs, timestamps and password hashes matched. Sessions and JWT secrets were not copied. Local data is unchanged.",
      );
    }
  }
  await source.query("ROLLBACK");
} catch {
  if (target && !committed) await target.query("ROLLBACK").catch(() => {});
  console.error(
    `Transfer ${committed ? "committed but reporting failed" : "stopped without committing target writes"} at stage: ${stage}. No credentials or database error details were printed.`,
  );
  process.exitCode = 1;
} finally {
  await source?.end().catch(() => {});
  await target?.end().catch(() => {});
}
