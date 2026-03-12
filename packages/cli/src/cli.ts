import { defineCommand } from "citty";

export const main = defineCommand({
  meta: {
    name: "pika",
    version: "0.0.0",
    description: "Replay and search coding agent sessions",
  },
  subCommands: {
    sync: () => import("./commands/sync.js").then((m) => m.default),
    login: () => import("./commands/login.js").then((m) => m.default),
    status: () => import("./commands/status.js").then((m) => m.default),
    init: () => import("./commands/init.js").then((m) => m.default),
    uninstall: () => import("./commands/uninstall.js").then((m) => m.default),
  },
});
