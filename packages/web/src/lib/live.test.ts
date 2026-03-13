import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkHealth } from "./live";
import type { D1Client, D1QueryResult } from "./d1";

// ── Mock version ──────────────────────────────────────────────

vi.mock("./version", () => ({
  APP_VERSION: "0.1.0",
}));

// ── Helpers ───────────────────────────────────────────────────

function mockD1(overrides: Partial<D1Client> = {}): D1Client {
  return {
    query: vi.fn().mockResolvedValue({ results: [{ "1": 1 }], meta: { changes: 0, duration: 0 } } satisfies D1QueryResult),
    execute: vi.fn(),
    firstOrNull: vi.fn(),
    ...overrides,
  } as unknown as D1Client;
}

// ── Tests ─────────────────────────────────────────────────────

describe("checkHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok when D1 responds", async () => {
    const db = mockD1();
    const result = await checkHealth(db);

    expect(result.status).toBe("ok");
    expect(result.version).toBe("0.1.0");
    expect(result).toHaveProperty("d1.latencyMs");
    expect((result as { d1: { latencyMs: number } }).d1.latencyMs).toBeGreaterThanOrEqual(0);
    expect(db.query).toHaveBeenCalledWith("SELECT 1");
  });

  it("returns error when D1 throws", async () => {
    const db = mockD1({
      query: vi.fn().mockRejectedValue(new Error("D1 network error: timeout")),
    });

    const result = await checkHealth(db);

    expect(result.status).toBe("error");
    expect(result.version).toBe("0.1.0");
    expect((result as { d1: { error: string } }).d1.error).toBe(
      "D1 network error: timeout",
    );
  });

  it("error response does not contain the word 'ok'", async () => {
    const db = mockD1({
      query: vi.fn().mockRejectedValue(new Error("connection refused")),
    });

    const result = await checkHealth(db);
    const serialized = JSON.stringify(result);

    expect(result.status).toBe("error");
    // Must NOT contain "ok" as a status or value (keyword-based monitors)
    expect(serialized).not.toContain('"ok"');
  });

  it("handles non-Error thrown values", async () => {
    const db = mockD1({
      query: vi.fn().mockRejectedValue("string error"),
    });

    const result = await checkHealth(db);

    expect(result.status).toBe("error");
    expect((result as { d1: { error: string } }).d1.error).toBe("string error");
  });

  it("latencyMs reflects actual elapsed time", async () => {
    const db = mockD1({
      query: vi.fn().mockImplementation(
        () => new Promise((r) => setTimeout(() => r({ results: [], meta: { changes: 0, duration: 0 } }), 20)),
      ),
    });

    const result = await checkHealth(db);

    expect(result.status).toBe("ok");
    expect((result as { d1: { latencyMs: number } }).d1.latencyMs).toBeGreaterThanOrEqual(15);
  });
});
