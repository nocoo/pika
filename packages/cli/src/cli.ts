import { defineCommand } from "citty";
import { PIKA_VERSION } from "@pika/core";

export const main = defineCommand({
  meta: {
    name: "pika",
    version: PIKA_VERSION,
    description: "Replay and search coding agent sessions",
  },
  subCommands: {
    sync: () => import("./commands/sync.js").then((m) => m.default),
    login: () => import("./commands/login.js").then((m) => m.default),
    status: () => import("./commands/status.js").then((m) => m.default),
  },
});
