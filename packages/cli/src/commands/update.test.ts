/**
 * Tests for pika update command.
 *
 * Since update.ts now just calls createUpdateCommand from base-cli,
 * we only need to verify it's configured correctly.
 */

import { describe, expect, it } from "vitest";
import updateCommand from "./update";

describe("pika update", () => {
  it("has correct command metadata", () => {
    expect(updateCommand.meta?.name).toBe("update");
    expect(updateCommand.meta?.description).toContain("pika");
  });

  it("has check argument", () => {
    expect(updateCommand.args?.check).toBeDefined();
    expect(updateCommand.args?.check?.type).toBe("boolean");
  });

  it("has run function", () => {
    expect(typeof updateCommand.run).toBe("function");
  });
});
