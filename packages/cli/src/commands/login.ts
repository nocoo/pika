import { homedir } from "node:os";
import { join } from "node:path";
import {
  consola,
  defineCommand,
  openBrowser,
  performLogin,
} from "@nocoo/cli-base";
import { CONFIG_DIR, LOGIN_TIMEOUT_MS } from "@pika/core";
import { ConfigManager } from "../config/manager";

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
      openBrowser,
      log: (msg: string) => consola.info(msg),
      onSaveToken: (token: string) => config.write({ token }),
      apiUrl: config.getApiUrl(),
      timeoutMs: LOGIN_TIMEOUT_MS,
      useStateNonce: true,
    });

    if (result.success) {
      consola.success(`Logged in as ${result.email || "unknown"}`);
    } else {
      consola.error(result.error || "Login failed");
    }
  },
});
