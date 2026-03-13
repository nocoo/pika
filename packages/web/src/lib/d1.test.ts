import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { D1Client, D1Error, getD1Client, resetD1Client } from "./d1";

// ── Mock fetch ─────────────────────────────────────────────────

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

function errorResponse(status: number, message: string) {
  return new Response(
    JSON.stringify({ success: false, errors: [{ message }] }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

const cfg = {
  accountId: "acc-1",
  databaseId: "db-1",
  apiToken: "tok-1",
};

// ── Constructor ────────────────────────────────────────────────

describe("D1Client constructor", () => {
  it("throws when accountId is empty", () => {
    expect(() => new D1Client({ ...cfg, accountId: "" })).toThrow(
      "accountId is required",
    );
  });

  it("throws when databaseId is empty", () => {
    expect(() => new D1Client({ ...cfg, databaseId: "" })).toThrow(
      "databaseId is required",
    );
  });

  it("throws when apiToken is empty", () => {
    expect(() => new D1Client({ ...cfg, apiToken: "" })).toThrow(
      "apiToken is required",
    );
  });
});

// ── query() ────────────────────────────────────────────────────

describe("D1Client.query", () => {
  it("sends POST to correct D1 endpoint with sql and params", async () => {
    mockFetch.mockResolvedValue(okResponse([{ id: "1", name: "Alice" }]));
    const client = new D1Client(cfg);

    await client.query("SELECT * FROM users WHERE id = ?", ["1"]);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/acc-1/d1/database/db-1/query",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer tok-1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql: "SELECT * FROM users WHERE id = ?", params: ["1"] }),
      },
    );
  });

  it("returns typed results and meta", async () => {
    mockFetch.mockResolvedValue(
      okResponse(
        [{ id: "1", email: "a@b.com" }],
        { changes: 0, duration: 5 },
      ),
    );
    const client = new D1Client(cfg);

    const result = await client.query<{ id: string; email: string }>(
      "SELECT * FROM users",
    );

    expect(result.results).toEqual([{ id: "1", email: "a@b.com" }]);
    expect(result.meta.duration).toBe(5);
  });

  it("defaults params to empty array", async () => {
    mockFetch.mockResolvedValue(okResponse([]));
    const client = new D1Client(cfg);

    await client.query("SELECT 1");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params).toEqual([]);
  });

  it("returns empty results when API returns no result array", async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, result: [{}] }),
        { status: 200 },
      ),
    );
    const client = new D1Client(cfg);

    const result = await client.query("SELECT 1");

    expect(result.results).toEqual([]);
    expect(result.meta).toEqual({ changes: 0, duration: 0 });
  });

  it("throws D1Error on HTTP error response", async () => {
    mockFetch.mockResolvedValue(errorResponse(400, "SQLITE_ERROR: no such table"));
    const client = new D1Client(cfg);

    const err = await client.query("SELECT * FROM nonexistent").catch((e) => e);
    expect(err).toBeInstanceOf(D1Error);
    expect(err.message).toMatch(/SQLITE_ERROR/);
  });

  it("includes status and errors on D1Error", async () => {
    mockFetch.mockResolvedValue(errorResponse(403, "Forbidden"));
    const client = new D1Client(cfg);

    try {
      await client.query("SELECT 1");
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(D1Error);
      const d1err = err as D1Error;
      expect(d1err.status).toBe(403);
      expect(d1err.errors).toEqual([{ message: "Forbidden" }]);
    }
  });

  it("throws D1Error with generic message when no error details", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 500 }),
    );
    const client = new D1Client(cfg);

    await expect(client.query("SELECT 1")).rejects.toThrow(/D1 HTTP 500/);
  });

  it("throws D1Error on network failure", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new D1Client(cfg);

    await expect(client.query("SELECT 1")).rejects.toThrow(
      /D1 network error: ECONNREFUSED/,
    );
  });

  it("wraps non-Error network failures", async () => {
    mockFetch.mockRejectedValue("string error");
    const client = new D1Client(cfg);

    await expect(client.query("SELECT 1")).rejects.toThrow(
      /D1 network error: string error/,
    );
  });
});

// ── execute() ──────────────────────────────────────────────────

describe("D1Client.execute", () => {
  it("returns meta from write query", async () => {
    mockFetch.mockResolvedValue(
      okResponse([], { changes: 1, duration: 2 }),
    );
    const client = new D1Client(cfg);

    const meta = await client.execute(
      "INSERT INTO users (id) VALUES (?)",
      ["1"],
    );

    expect(meta.changes).toBe(1);
    expect(meta.duration).toBe(2);
  });
});

// ── firstOrNull() ──────────────────────────────────────────────

describe("D1Client.firstOrNull", () => {
  it("returns first row when results exist", async () => {
    mockFetch.mockResolvedValue(
      okResponse([{ id: "1" }, { id: "2" }]),
    );
    const client = new D1Client(cfg);

    const row = await client.firstOrNull<{ id: string }>(
      "SELECT id FROM users",
    );

    expect(row).toEqual({ id: "1" });
  });

  it("returns null when no results", async () => {
    mockFetch.mockResolvedValue(okResponse([]));
    const client = new D1Client(cfg);

    const row = await client.firstOrNull("SELECT * FROM users WHERE id = ?", ["nope"]);

    expect(row).toBeNull();
  });
});

// ── Singleton factory ──────────────────────────────────────────

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
