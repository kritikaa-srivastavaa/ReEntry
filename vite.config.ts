import { defineConfig, loadEnv } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const api = new URL(env.VITE_API_URL || "http://localhost:3001/api");
  if (
    api.protocol !== "https:" &&
    !(
      api.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(api.hostname)
    )
  )
    throw new Error("Use HTTPS for the API, or HTTP on localhost only.");
  return {
    base: "./",
    plugins: [
      {
        name: "reentry-api-permission",
        generateBundle() {
          const manifest = JSON.parse(
            readFileSync(resolve(__dirname, "public/manifest.json"), "utf8"),
          );
          manifest.host_permissions = [`${api.protocol}//${api.hostname}/*`];
          this.emitFile({
            type: "asset",
            fileName: "manifest.json",
            source: JSON.stringify(manifest, null, 2),
          });
        },
      },
    ],
    build: {
      rollupOptions: {
        input: {
          popup: resolve(__dirname, "popup.html"),
          workspace: resolve(__dirname, "workspace.html"),
          background: resolve(__dirname, "src/background.ts"),
        },
        output: {
          entryFileNames: (chunk) =>
            chunk.name === "background"
              ? "background.js"
              : "assets/[name]-[hash].js",
        },
      },
    },
  };
});
