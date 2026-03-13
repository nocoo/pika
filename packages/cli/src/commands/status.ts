import { defineCommand } from "citty";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import consola from "consola";
import { CONFIG_DIR, PARSE_ERRORS_FILE } from "@pika/core";
import { ConfigManager } from "../config/manager.js";
import { CursorStore } from "../storage/cursor-store.js";
import { buildStatus, loadParseErrors, formatStatusLines } from "./status-display.js";

export default defineCommand({
  meta: {
    name: "status",
    description: "Show sync status and session stats",
  },
  args: {
    dev: {
      type: "boolean",
      default: false,
      description: "Use local dev server",
    },
  },
  async run({ args }) {
    const isDev = args.dev as boolean;

    const configDir = join(
      process.env.HOME ?? process.env.USERPROFILE ?? "~",
      ".config",
      CONFIG_DIR,
    );

    // Load config
    const config = new ConfigManager(configDir, isDev);
    const loggedIn = config.isLoggedIn();

    // Load cursor state
    const cursorStore = new CursorStore(configDir);
    const cursorState = await cursorStore.load();

    // Load parse errors
    let parseErrors;
    try {
      const content = await readFile(join(configDir, PARSE_ERRORS_FILE), "utf-8");
      parseErrors = loadParseErrors(content);
    } catch {
      parseErrors = [];
    }

    // Build + display
    const output = buildStatus({ loggedIn, cursorState, parseErrors });
    const lines = formatStatusLines(output);

    for (const line of lines) {
      if (line === "") {
        consola.log("");
      } else {
        consola.log(line);
      }
    }
  },
});
