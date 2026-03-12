import { defineCommand } from "citty";
import consola from "consola";

export default defineCommand({
  meta: {
    name: "uninstall",
    description: "Remove notifier hooks",
  },
  args: {
    "dry-run": {
      type: "boolean",
      default: false,
      description: "Preview changes without removing",
    },
    source: {
      type: "string",
      description: "Only uninstall for specific source",
    },
  },
  run({ args }) {
    consola.info("Uninstall command — not yet implemented");
  },
});
