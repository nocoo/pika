import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertTestDatabase,
  D1Client,
  getD1Client,
  resetD1Client,
  TEST_DATABASE_ID,
} from "./d1";

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  resetD1Client();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  mockFetch.mockReset();
});

function okResponse<T>(results: T[], meta = { changes: 0, duration: 1 }) {
  return new Response(
    JSON.stringify({ success: true, result: [{ results, meta }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("getD1Client", () => {
  it("returns same instance on repeated calls", () => {
    process.env.CF_ACCOUNT_ID = "a";
    process.env.CF_D1_DATABASE_ID = "d";
    process.env.CF_D1_API_TOKEN = "t";

    const a = getD1Client();
    const b = getD1Client();

    expect(a).toBe(b);

    delete process.env.CF_ACCOUNT_ID;
    delete process.env.CF_D1_DATABASE_ID;
    delete process.env.CF_D1_API_TOKEN;
  });

  it("creates new instance after resetD1Client", () => {
    process.env.CF_ACCOUNT_ID = "a";
    process.env.CF_D1_DATABASE_ID = "d";
    process.env.CF_D1_API_TOKEN = "t";

    const a = getD1Client();
    resetD1Client();
    const b = getD1Client();

    expect(a).not.toBe(b);

    delete process.env.CF_ACCOUNT_ID;
    delete process.env.CF_D1_DATABASE_ID;
    delete process.env.CF_D1_API_TOKEN;
  });
});

describe("assertTestDatabase (web wrapper)", () => {
  const savedDbId = process.env.CF_D1_DATABASE_ID;

  afterEach(() => {
    if (savedDbId !== undefined) {
      process.env.CF_D1_DATABASE_ID = savedDbId;
    } else {
      delete process.env.CF_D1_DATABASE_ID;
    }
  });

  it("throws when CF_D1_DATABASE_ID does not match test DB", async () => {
    process.env.CF_D1_DATABASE_ID = "production-db-id";

    await expect(assertTestDatabase()).rejects.toThrow(
      /D1 isolation FAILED.*does not match test DB/,
    );
  });

  it("throws when CF_D1_DATABASE_ID is undefined", async () => {
    delete process.env.CF_D1_DATABASE_ID;

    await expect(assertTestDatabase()).rejects.toThrow(/D1 isolation FAILED/);
  });

  it("throws when _test_marker table not found", async () => {
    process.env.CF_D1_DATABASE_ID = TEST_DATABASE_ID;
    mockFetch.mockResolvedValue(okResponse([]));

    const client = new D1Client({
      accountId: "a",
      databaseId: TEST_DATABASE_ID,
      apiToken: "t",
    });

    await expect(assertTestDatabase(client)).rejects.toThrow(
      /D1 isolation FAILED.*_test_marker table not found/,
    );
  });

  it("passes when DB ID matches and _test_marker exists", async () => {
    process.env.CF_D1_DATABASE_ID = TEST_DATABASE_ID;
    mockFetch.mockResolvedValue(okResponse([{ name: "_test_marker" }]));

    const client = new D1Client({
      accountId: "a",
      databaseId: TEST_DATABASE_ID,
      apiToken: "t",
    });

    await expect(assertTestDatabase(client)).resolves.toBeUndefined();
  });
});
