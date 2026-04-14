#!/usr/bin/env bun
import { runMain } from "@nocoo/cli-base";
import { main } from "./cli";

process.on("unhandledRejection", (err) => {
  console.error("[FATAL] Unhandled rejection:", err);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
  process.exit(1);
});

runMain(main);
