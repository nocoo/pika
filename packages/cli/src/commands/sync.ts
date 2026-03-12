import { defineCommand } from "citty";
import consola from "consola";

export default defineCommand({
  meta: {
    name: "sync",
    description: "Parse local sessions and upload to Pika",
  },
  args: {
    upload: {
      type: "boolean",
      default: true,
      description: "Upload parsed sessions (default: true)",
    },
    dev: {
      type: "boolean",
      default: false,
      description: "Use local dev server",
    },
  },
  run({ args }) {
    consola.info("Sync command — not yet implemented");
  },
});
