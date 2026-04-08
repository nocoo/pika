import { defineCommand } from "@nocoo/cli-base";

export default defineCommand({
  meta: {
    name: "projects",
    description: "Browse projects",
  },
  subCommands: {
    list: () => import("./list.js").then((m) => m.default),
  },
});
