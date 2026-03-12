import { defineCommand } from "citty";
import consola from "consola";

export default defineCommand({
  meta: {
    name: "status",
    description: "Show sync status and session stats",
  },
  run() {
    consola.info("Status command — not yet implemented");
  },
});
