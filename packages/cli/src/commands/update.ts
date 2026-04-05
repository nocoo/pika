/**
 * pika update — update CLI to latest version.
 *
 * Detects package manager and runs appropriate update command.
 */

import { execSync } from "node:child_process";
import { PIKA_VERSION } from "@pika/core";
import { defineCommand } from "citty";
import { consola } from "consola";

/** Package name on npm */
const PACKAGE_NAME = "@pika/cli";

/** Detect which package manager installed the CLI globally */
function detectPackageManager(): "npm" | "bun" | "pnpm" | "yarn" | null {
  try {
    // Check if installed via bun
    const bunGlobal = execSync("bun pm ls -g 2>/dev/null", {
      encoding: "utf-8",
    });
    if (bunGlobal.includes(PACKAGE_NAME)) return "bun";
  } catch {
    // Not bun
  }

  try {
    // Check if installed via pnpm
    const pnpmGlobal = execSync("pnpm list -g --depth=0 2>/dev/null", {
      encoding: "utf-8",
    });
    if (pnpmGlobal.includes(PACKAGE_NAME)) return "pnpm";
  } catch {
    // Not pnpm
  }

  try {
    // Check if installed via yarn
    const yarnGlobal = execSync("yarn global list 2>/dev/null", {
      encoding: "utf-8",
    });
    if (yarnGlobal.includes(PACKAGE_NAME)) return "yarn";
  } catch {
    // Not yarn
  }

  try {
    // Check if installed via npm
    const npmGlobal = execSync("npm list -g --depth=0 2>/dev/null", {
      encoding: "utf-8",
    });
    if (npmGlobal.includes(PACKAGE_NAME)) return "npm";
  } catch {
    // Not npm
  }

  return null;
}

/** Get latest version from npm registry */
async function getLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { version: string };
    return data.version;
  } catch {
    return null;
  }
}

/** Run the update command */
function runUpdate(pm: "npm" | "bun" | "pnpm" | "yarn"): void {
  const commands: Record<typeof pm, string> = {
    npm: `npm update -g ${PACKAGE_NAME}`,
    bun: `bun update -g ${PACKAGE_NAME}`,
    pnpm: `pnpm update -g ${PACKAGE_NAME}`,
    yarn: `yarn global upgrade ${PACKAGE_NAME}`,
  };

  const cmd = commands[pm];
  consola.info(`Running: ${cmd}`);

  try {
    execSync(cmd, { stdio: "inherit" });
    consola.success("Update complete!");
  } catch (err) {
    consola.error(`Update failed. Try running manually: ${cmd}`);
    throw err;
  }
}

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
    const latest = await getLatestVersion();
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
    const pm = detectPackageManager();
    if (!pm) {
      consola.warn("Could not detect package manager. Please update manually:");
      consola.info(`  npm update -g ${PACKAGE_NAME}`);
      consola.info(`  # or: bun update -g ${PACKAGE_NAME}`);
      consola.info(`  # or: pnpm update -g ${PACKAGE_NAME}`);
      return;
    }

    consola.info(`Detected package manager: ${pm}`);
    consola.info(`Updating ${PIKA_VERSION} → ${latest}...`);

    runUpdate(pm);
  },
});
