import { beforeEach, describe, expect, it } from "vitest";
import {
  ApiError,
  OutputFormatter,
  resolveFormat,
  withErrorHandling,
} from "./formatter.js";

describe("OutputFormatter", () => {
  function createFormatter(format: string) {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const formatter = new OutputFormatter({
      format: format as "json" | "table" | "minimal",
      stdout: {
        write: (s: string) => {
          stdout.push(s);
          return true;
        },
      } as NodeJS.WritableStream,
      stderr: {
        write: (s: string) => {
          stderr.push(s);
          return true;
        },
      } as NodeJS.WritableStream,
    });

    return { formatter, stdout, stderr };
  }

  describe("json format", () => {
    it("outputs full envelope to stdout", () => {
      const { formatter, stdout } = createFormatter("json");

      const apiResponse = {
        sessions: [{ id: "1" }, { id: "2" }],
        cursor: "next",
        hasMore: true,
      };

      formatter.response(
        { items: apiResponse.sessions, raw: apiResponse },
        { columns: [], minimalKey: "id" },
      );

      const output = stdout.join("");
      expect(output).toContain('"sessions"');
      expect(output).toContain('"cursor": "next"');
      expect(output).toContain('"hasMore": true');
    });
  });

  describe("minimal format", () => {
    it("outputs only IDs, one per line", () => {
      const { formatter, stdout } = createFormatter("minimal");

      const items = [{ id: "sess_1" }, { id: "sess_2" }, { id: "sess_3" }];

      formatter.response(
        { items, raw: { items } },
        { columns: [], minimalKey: "id" },
      );

      expect(stdout.join("")).toBe("sess_1\nsess_2\nsess_3\n");
    });
  });

  describe("table format", () => {
    it("outputs formatted table", () => {
      const { formatter, stdout } = createFormatter("table");

      const items = [
        { id: "1", name: "Alice", score: 100 },
        { id: "2", name: "Bob", score: 85 },
      ];

      formatter.response(
        { items, raw: { items } },
        {
          columns: [
            { key: "id", header: "ID" },
            { key: "name", header: "Name" },
            { key: "score", header: "Score", align: "right" },
          ],
          minimalKey: "id",
        },
      );

      const output = stdout.join("");
      expect(output).toContain("ID");
      expect(output).toContain("Name");
      expect(output).toContain("Score");
      expect(output).toContain("Alice");
      expect(output).toContain("Bob");
    });

    it("shows message when no items", () => {
      const { formatter, stderr } = createFormatter("table");

      formatter.response(
        { items: [], raw: { items: [] } },
        { columns: [], minimalKey: "id" },
      );

      expect(stderr.join("")).toContain("No items found");
    });

    it("supports function columns", () => {
      const { formatter, stdout } = createFormatter("table");

      const items = [{ first: "John", last: "Doe" }];

      formatter.response(
        { items, raw: { items } },
        {
          columns: [
            {
              key: (row) => `${row.first} ${row.last}`,
              header: "Full Name",
            },
          ],
          minimalKey: "first",
        },
      );

      expect(stdout.join("")).toContain("John Doe");
    });
  });

  describe("messages", () => {
    it("info writes to stderr", () => {
      const { formatter, stderr } = createFormatter("json");
      formatter.info("Test message");
      expect(stderr.join("")).toContain("Test message");
    });

    it("success writes to stderr", () => {
      const { formatter, stderr } = createFormatter("json");
      formatter.success("Done!");
      expect(stderr.join("")).toContain("Done!");
    });

    it("error writes to stderr", () => {
      const { formatter, stderr } = createFormatter("json");
      formatter.error("Something failed");
      expect(stderr.join("")).toContain("Something failed");
    });

    it("warn writes to stderr", () => {
      const { formatter, stderr } = createFormatter("json");
      formatter.warn("Be careful");
      expect(stderr.join("")).toContain("Be careful");
    });
  });

  describe("item", () => {
    it("outputs item as json in json format", () => {
      const { formatter, stdout } = createFormatter("json");
      formatter.item({ id: "123", name: "Test" });
      const output = stdout.join("");
      expect(output).toContain('"id": "123"');
      expect(output).toContain('"name": "Test"');
    });

    it("outputs item as key-value pairs in table format", () => {
      const { formatter, stdout } = createFormatter("table");
      formatter.item({ id: "123", name: "Test" });
      const output = stdout.join("");
      expect(output).toContain("id");
      expect(output).toContain("123");
      expect(output).toContain("name");
      expect(output).toContain("Test");
    });

    it("falls back to json for other formats", () => {
      const { formatter, stdout } = createFormatter("minimal");
      formatter.item({ id: "123" });
      expect(stdout.join("")).toContain('"id": "123"');
    });
  });

  describe("getFormat", () => {
    it("returns the configured format", () => {
      const { formatter } = createFormatter("json");
      expect(formatter.getFormat()).toBe("json");
    });
  });

  describe("table truncation", () => {
    it("truncates long values with ellipsis", () => {
      const { formatter, stdout } = createFormatter("table");

      const items = [{ id: "1", name: "A very long name that exceeds width" }];

      formatter.response(
        { items, raw: { items } },
        {
          columns: [
            { key: "id", header: "ID", width: 2 },
            { key: "name", header: "Name", width: 10 },
          ],
          minimalKey: "id",
        },
      );

      const output = stdout.join("");
      expect(output).toContain("A very lo…");
    });

    it("handles null/undefined values", () => {
      const { formatter, stdout } = createFormatter("table");

      const items = [{ id: "1", name: null as unknown as string }];

      formatter.response(
        { items, raw: { items } },
        {
          columns: [
            { key: "id", header: "ID" },
            { key: "name", header: "Name" },
          ],
          minimalKey: "id",
        },
      );

      const output = stdout.join("");
      expect(output).toContain("ID");
      expect(output).toContain("1");
    });
  });

  describe("response default fallback", () => {
    it("falls back to json for unknown formats", () => {
      const { formatter, stdout } = createFormatter("text");
      const apiResponse = { items: [{ id: "1" }] };

      formatter.response(
        { items: apiResponse.items, raw: apiResponse },
        { columns: [], minimalKey: "id" },
      );

      expect(stdout.join("")).toContain('"items"');
    });
  });
});

describe("resolveFormat", () => {
  it("returns explicit format when provided", () => {
    expect(resolveFormat("json")).toBe("json");
    expect(resolveFormat("table")).toBe("table");
    expect(resolveFormat("minimal")).toBe("minimal");
  });

  it("returns text/markdown when explicitly requested", () => {
    expect(resolveFormat("text")).toBe("text");
    expect(resolveFormat("markdown")).toBe("markdown");
  });

  it("returns table when TTY and no explicit format", () => {
    expect(resolveFormat(undefined, true)).toBe("table");
  });

  it("returns json when not TTY and no explicit format", () => {
    expect(resolveFormat(undefined, false)).toBe("json");
  });

  it("returns table for invalid explicit format with TTY", () => {
    expect(resolveFormat("invalid", true)).toBe("table");
  });

  it("returns json for invalid explicit format without TTY", () => {
    expect(resolveFormat("invalid", false)).toBe("json");
  });
});

describe("withErrorHandling", () => {
  function createMockFormatter() {
    const errors: string[] = [];
    return {
      formatter: {
        error: (msg: string) => errors.push(msg),
      } as OutputFormatter,
      errors,
    };
  }

  beforeEach(() => {
    (process as unknown as { exitCode?: number }).exitCode = undefined;
  });

  it("executes handler successfully", async () => {
    const { formatter } = createMockFormatter();
    let executed = false;

    await withErrorHandling(async () => {
      executed = true;
    }, formatter);

    expect(executed).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it("catches ApiError and formats message", async () => {
    const { formatter, errors } = createMockFormatter();

    await withErrorHandling(async () => {
      throw new ApiError("Not found", 404);
    }, formatter);

    expect(errors[0]).toBe("Not found");
    expect(process.exitCode).toBe(1);
  });

  it("handles 401 with login hint", async () => {
    const { formatter, errors } = createMockFormatter();

    await withErrorHandling(async () => {
      throw new ApiError("Unauthorized", 401);
    }, formatter);

    expect(errors[0]).toContain("pika login");
    expect(process.exitCode).toBe(1);
  });

  it("catches generic Error", async () => {
    const { formatter, errors } = createMockFormatter();

    await withErrorHandling(async () => {
      throw new Error("Something broke");
    }, formatter);

    expect(errors[0]).toBe("Something broke");
    expect(process.exitCode).toBe(1);
  });

  it("catches unknown errors", async () => {
    const { formatter, errors } = createMockFormatter();

    await withErrorHandling(async () => {
      throw "string error";
    }, formatter);

    expect(errors[0]).toContain("unknown error");
    expect(process.exitCode).toBe(1);
  });
});
