import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const rootPkg = JSON.parse(
  readFileSync(resolve(__dirname, "../../package.json"), "utf8"),
) as { version: string };

// docs/17 §静态产物目录约定: vite writes to packages/web-worker/dist;
// wrangler reads `[assets] directory = "./dist"` (same physical dir).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.PIKA_WEB_WORKER_URL ?? "http://127.0.0.1:7025";

  return {
    plugins: [react(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(rootPkg.version),
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
      },
    },
    build: {
      outDir: "../web-worker/dist",
      emptyOutDir: true,
    },
    server: {
      port: 7024,
      allowedHosts: ["pika.dev.hexly.ai"],
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
        },
      },
    },
  };
});
