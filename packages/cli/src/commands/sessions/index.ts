import { defineCommand } from "@nocoo/cli-base";

export default defineCommand({
  meta: {
    name: "sessions",
    description: "Manage sessions",
  },
  subCommands: {
    list: () => import("./list.js").then((m) => m.default),
    get: () => import("./get.js").then((m) => m.default),
    content: () => import("./content.js").then((m) => m.default),
    trash: () => import("./trash.js").then((m) => m.default),
    star: () => import("./star.js").then((m) => m.default),
  },
});
