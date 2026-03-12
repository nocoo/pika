import { defineCommand } from "citty";
import consola from "consola";

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
  run({ args }) {
    consola.info("Login command — not yet implemented");
  },
});
