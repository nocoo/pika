import { defineCommand } from "citty";
import consola from "consola";

export default defineCommand({
  meta: {
    name: "init",
    description: "Install notifier hooks for AI tools",
  },
  args: {
    "dry-run": {
      type: "boolean",
      default: false,
      description: "Preview changes without installing",
    },
    source: {
      type: "string",
      description: "Only install for specific source",
    },
  },
  run({ args }) {
    consola.info("Init command — not yet implemented");
  },
});
