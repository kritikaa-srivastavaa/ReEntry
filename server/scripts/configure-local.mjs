import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
const root = new URL("../../", import.meta.url);
const config = JSON.parse(
  await readFile(new URL(".reentry-dev/local-config.json", root), "utf8"),
);
const admin = new pg.Client({
  host: "127.0.0.1",
  port: config.port,
  user: "reentry_admin",
  password: config.adminPassword,
  database: "postgres",
});
await admin.connect();
try {
  if (
    !(await admin.query("SELECT 1 FROM pg_roles WHERE rolname = 'reentry'"))
      .rowCount
  ) {
    // Password is generated hexadecimal text, checked before use in PostgreSQL DDL.
    if (!/^[a-f0-9]{64}$/.test(config.appPassword))
      throw new Error("Invalid generated password.");
    await admin.query(
      `CREATE ROLE reentry LOGIN PASSWORD '${config.appPassword}'`,
    );
  }
  if (
    !(await admin.query("SELECT 1 FROM pg_database WHERE datname = 'reentry'"))
      .rowCount
  )
    await admin.query("CREATE DATABASE reentry OWNER reentry");
} finally {
  await admin.end();
}
const serverEnv = new URL("server/.env", root);
const origins = ["http://localhost:5173", "http://127.0.0.1:5173"];
if (config.extensionId) {
  if (!/^[a-p]{32}$/.test(config.extensionId))
    throw new Error("Invalid extension ID.");
  origins.push(`chrome-extension://${config.extensionId}`);
}
let existing = await readFile(serverEnv, "utf8").catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (existing === null) {
  existing = `# Managed local ReEntry development configuration; do not commit.\nDATABASE_URL=postgresql://reentry:${config.appPassword}@127.0.0.1:${config.port}/reentry\nJWT_SECRET=${config.jwtSecret}\nPORT=3001\nHOST=127.0.0.1\nCORS_ORIGINS=${origins.join(",")}\n`;
} else {
  if (
    !existing.startsWith("# Managed local ReEntry development configuration;")
  )
    throw new Error(
      "Refusing to overwrite independently configured server/.env.",
    );
  const configured =
    existing
      .match(/^CORS_ORIGINS=(.*)$/m)?.[1]
      .split(",")
      .map((value) => value.trim()) || [];
  existing = existing.replace(
    /^CORS_ORIGINS=.*$/m,
    `CORS_ORIGINS=${[...new Set([...configured, ...origins])].join(",")}`,
  );
}
await writeFile(serverEnv, existing);
await writeFile(
  new URL(".env", root),
  "VITE_API_URL=http://localhost:3001/api\n",
  { flag: "wx" },
).catch((error) => {
  if (error.code !== "EEXIST") throw error;
});
console.log(
  "Local application database and private environment configuration are ready.",
);
