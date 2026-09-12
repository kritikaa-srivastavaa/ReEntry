import { readConfig } from "./config.js";
import { connectDatabase } from "./db.js";
import { createApp } from "./app.js";
const config = readConfig();
const { db, pool } = connectDatabase(config.DATABASE_URL);
await pool.query("SELECT 1");
const server = createApp(db, {
  jwtSecret: config.JWT_SECRET,
  trustProxyHops: config.TRUST_PROXY_HOPS,
  origins: config.CORS_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
}).listen(config.PORT, config.HOST, () =>
  console.log(`ReEntry API listening on http://${config.HOST}:${config.PORT}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
