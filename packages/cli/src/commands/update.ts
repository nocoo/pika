/**
 * pika update — update CLI to latest version.
 *
 * Uses cli-base utilities for package manager detection and version checking.
 */

import { execSync } from "node:child_process";
import {
  consola,
  defineCommand,
  detectPackageManager,
  getLatestVersion,
  getUpdateCommand,
} from "@nocoo/cli-base";
import { PIKA_VERSION } from "@pika/core";

/** Package name on npm */
const PACKAGE_NAME = "@nocoo/pika";

export default defineCommand({
  meta: {
    name: "update",
    description: "Update pika CLI to the latest version",
  },
  args: {
    check: {
      type: "boolean",
      description: "Only check for updates, don't install",
      default: false,
    },
  },
  async run({ args }) {
    consola.info(`Current version: ${PIKA_VERSION}`);

    // Check latest version
    const latest = await getLatestVersion(PACKAGE_NAME);
    if (!latest) {
      consola.warn("Could not fetch latest version from npm registry");
      return;
    }

    consola.info(`Latest version: ${latest}`);

    if (PIKA_VERSION === latest) {
      consola.success("You are already on the latest version!");
      return;
    }

    if (args.check) {
      consola.info(`Update available: ${PIKA_VERSION} → ${latest}`);
      consola.info("Run `pika update` to install the update");
      return;
    }

    // Detect package manager
    const pm = detectPackageManager(PACKAGE_NAME);
    if (!pm) {
      consola.warn("Could not detect package manager. Please update manually:");
      consola.info(`  npm update -g ${PACKAGE_NAME}`);
      consola.info(`  # or: bun update -g ${PACKAGE_NAME}`);
      consola.info(`  # or: pnpm update -g ${PACKAGE_NAME}`);
      return;
    }

    consola.info(`Detected package manager: ${pm}`);
    consola.info(`Updating ${PIKA_VERSION} → ${latest}...`);

    const cmd = getUpdateCommand(pm, PACKAGE_NAME);
    consola.info(`Running: ${cmd}`);

    try {
      execSync(cmd, { stdio: "inherit" });
      consola.success("Update complete!");
    } catch (err) {
      consola.error(`Update failed. Try running manually: ${cmd}`);
      throw err;
    }
  },
});
