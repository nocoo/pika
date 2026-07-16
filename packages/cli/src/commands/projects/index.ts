import { defineCommand } from "@nocoo/base-cli";

export default defineCommand({
  meta: {
    name: "projects",
    description: "Browse projects",
  },
  subCommands: {
    list: () => import("./list.js").then((m) => m.default),
  },
});
