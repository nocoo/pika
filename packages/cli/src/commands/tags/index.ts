import { defineCommand } from "@nocoo/cli-base";

export default defineCommand({
  meta: {
    name: "tags",
    description: "Manage tags",
  },
  subCommands: {
    list: () => import("./list.js").then((m) => m.default),
    create: () => import("./create.js").then((m) => m.default),
    add: () => import("./add.js").then((m) => m.default),
    remove: () => import("./remove.js").then((m) => m.default),
  },
});
