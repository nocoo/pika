import { defineCommand } from "@nocoo/cli-base";
import { PIKA_VERSION } from "@pika/core";

export const main = defineCommand({
  meta: {
    name: "pika",
    version: PIKA_VERSION,
    description: "Replay and search coding agent sessions",
  },
  subCommands: {
    // Existing
    sync: () => import("./commands/sync.js").then((m) => m.default),
    login: () => import("./commands/login.js").then((m) => m.default),
    status: () => import("./commands/status.js").then((m) => m.default),
    update: () => import("./commands/update.js").then((m) => m.default),

    // New CRUD commands
    sessions: () => import("./commands/sessions/index.js").then((m) => m.default),
    projects: () => import("./commands/projects/index.js").then((m) => m.default),
    search: () => import("./commands/search/index.js").then((m) => m.default),
    tags: () => import("./commands/tags/index.js").then((m) => m.default),
  },
});
