import { defineCommand } from "citty";
import consola from "consola";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { CONFIG_DIR, LOGIN_TIMEOUT_MS } from "@pika/core";
import { ConfigManager } from "../config/manager";
import { performLogin } from "./login-flow";

/** Platform-aware browser open command */
function getBrowserCommand(): string {
  switch (platform()) {
    case "darwin":
      return "open";
    case "win32":
      return "start";
    default:
      return "xdg-open";
  }
}

export default defineCommand({
  meta: {
    name: "login",
    description: "Connect CLI to dashboard via browser OAuth",
  },
  args: {
    force: {
      type: "boolean",
      default: false,
      description: "Force re-login even if already authenticated",
    },
    dev: {
      type: "boolean",
      default: false,
      description: "Use local dev server",
    },
  },
  async run({ args }) {
    const configDir = join(homedir(), ".config", CONFIG_DIR);
    const config = new ConfigManager(configDir, args.dev);

    if (config.isLoggedIn() && !args.force) {
      consola.info("Already logged in. Use --force to re-authenticate.");
      return;
    }

    consola.start("Opening browser for authentication...");

    const result = await performLogin({
      openBrowser: async (url: string) => {
        const { exec } = await import("node:child_process");
        const cmd = getBrowserCommand();
        return new Promise<void>((resolve, reject) => {
          exec(`${cmd} "${url}"`, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      },
      log: (msg: string) => consola.info(msg),
      config,
      apiUrl: config.getApiUrl(),
      timeoutMs: LOGIN_TIMEOUT_MS,
    });

    if (result.success) {
      consola.success(`Logged in as ${result.email || "unknown"}`);
    } else {
      consola.error(result.error || "Login failed");
    }
  },
});
