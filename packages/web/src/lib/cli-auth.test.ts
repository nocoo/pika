import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Env helpers (bun test has no vi.stubEnv) ───────────────────

const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined) {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    (process.env as Record<string, string>)[key] = value;
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      (process.env as Record<string, string>)[key] = value;
    }
  }
  // Clear saved entries
  for (const key of Object.keys(savedEnv)) delete savedEnv[key];
}
import {
  generateApiKey,
  handleCliAuth,
  resolveUser,
  E2E_TEST_USER_ID,
  E2E_TEST_USER_EMAIL,
  type CliAuthDb,
} from "./cli-auth";
import { API_KEY_PREFIX, API_KEY_HEX_LENGTH } from "@pika/core";
import { isValidApiKey } from "@pika/core";

// ── Mock DB ────────────────────────────────────────────────────

function createMockDb(overrides?: Partial<CliAuthDb>): CliAuthDb {
  return {
    getApiKey: vi.fn().mockResolvedValue(null),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    getUserByApiKey: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

// ── generateApiKey ─────────────────────────────────────────────

describe("generateApiKey", () => {
  it("returns a key with correct prefix and length", () => {
    const key = generateApiKey();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key.length).toBe(API_KEY_PREFIX.length + API_KEY_HEX_LENGTH);
  });

  it("generates valid API keys", () => {
    const key = generateApiKey();
    expect(isValidApiKey(key)).toBe(true);
  });

  it("generates unique keys each call", () => {
    const keys = new Set(Array.from({ length: 10 }, () => generateApiKey()));
    expect(keys.size).toBe(10);
  });

  it("accepts custom randomBytes function", () => {
    const fixedBytes = new Uint8Array(16).fill(0xab);
    const key = generateApiKey(() => fixedBytes);
    expect(key).toBe("pk_abababababababababababababababab");
  });
});

// ── handleCliAuth ──────────────────────────────────────────────

describe("handleCliAuth", () => {
  const signInUrl = "/login";
  const currentUrl =
    "http://localhost:7040/api/auth/cli?callback=http://localhost:12345/callback";

  function defaultDeps(dbOverrides?: Partial<CliAuthDb>) {
    return { signInUrl, currentUrl, db: createMockDb(dbOverrides) };
  }

  it("redirects to sign-in with missing callback when unauthenticated", async () => {
    const result = await handleCliAuth(
      { callback: null, userEmail: null, userId: null },
      defaultDeps(),
    );
    expect(result.error).toBe("Missing callback parameter");
    expect(result.redirectUrl).toBe(signInUrl);
  });

  it("redirects to sign-in with callbackUrl when unauthenticated", async () => {
    const callback = "http://localhost:12345/callback";
    const result = await handleCliAuth(
      { callback, userEmail: null, userId: null },
      defaultDeps(),
    );
    expect(result.error).toBeUndefined();
    expect(result.redirectUrl).toContain(signInUrl);
    expect(result.redirectUrl).toContain("callbackUrl=");
    expect(result.redirectUrl).toContain(encodeURIComponent(currentUrl));
  });

  it("returns error when authenticated but callback is missing", async () => {
    const result = await handleCliAuth(
      { callback: null, userEmail: "u@e.com", userId: "u1" },
      defaultDeps(),
    );
    expect(result.error).toBe("Missing callback parameter");
    expect(result.status).toBe(400);
  });

  it("returns error when callback is not a valid URL", async () => {
    const result = await handleCliAuth(
      { callback: "not-a-url", userEmail: "u@e.com", userId: "u1" },
      defaultDeps(),
    );
    expect(result.error).toBe("Invalid callback URL");
    expect(result.status).toBe(400);
  });

  it("returns error when callback is not localhost", async () => {
    const result = await handleCliAuth(
      {
        callback: "http://evil.com/callback",
        userEmail: "u@e.com",
        userId: "u1",
      },
      defaultDeps(),
    );
    expect(result.error).toBe("Callback must be localhost");
    expect(result.status).toBe(400);
  });

  it("fetches existing API key from DB (no generation)", async () => {
    const existingKey = "pk_" + "e".repeat(32);
    const deps = defaultDeps({ getApiKey: vi.fn().mockResolvedValue(existingKey) });

    const result = await handleCliAuth(
      {
        callback: "http://localhost:12345/callback",
        userEmail: "user@example.com",
        userId: "u1",
      },
      deps,
    );

    expect(result.apiKey).toBe(existingKey);
    expect(deps.db.getApiKey).toHaveBeenCalledWith("u1");
    expect(deps.db.setApiKey).not.toHaveBeenCalled();
  });

  it("generates and persists API key when none exists in DB", async () => {
    const callback = "http://localhost:12345/callback";
    const fixedKey = "pk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const deps = defaultDeps();

    const result = await handleCliAuth(
      { callback, userEmail: "user@example.com", userId: "u1" },
      { ...deps, generateKey: () => fixedKey },
    );

    expect(result.apiKey).toBe(fixedKey);
    expect(result.error).toBeUndefined();
    expect(deps.db.getApiKey).toHaveBeenCalledWith("u1");
    expect(deps.db.setApiKey).toHaveBeenCalledWith("u1", fixedKey);

    const url = new URL(result.redirectUrl!);
    expect(url.hostname).toBe("localhost");
    expect(url.port).toBe("12345");
    expect(url.pathname).toBe("/callback");
    expect(url.searchParams.get("api_key")).toBe(fixedKey);
    expect(url.searchParams.get("email")).toBe("user@example.com");
  });

  it("allows 127.0.0.1 as callback host", async () => {
    const callback = "http://127.0.0.1:54321/callback";
    const result = await handleCliAuth(
      { callback, userEmail: "user@example.com", userId: "u1" },
      {
        ...defaultDeps(),
        generateKey: () => "pk_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.apiKey).toBeDefined();
    expect(result.redirectUrl).toContain("127.0.0.1:54321");
  });

  it("uses real generateApiKey when no custom generator provided", async () => {
    const callback = "http://localhost:12345/callback";
    const result = await handleCliAuth(
      { callback, userEmail: "user@example.com", userId: "u1" },
      defaultDeps(),
    );
    expect(result.apiKey).toBeDefined();
    expect(isValidApiKey(result.apiKey!)).toBe(true);
  });
});

// ── resolveUser ────────────────────────────────────────────────

describe("resolveUser", () => {
  beforeEach(() => {
    setEnv("E2E_SKIP_AUTH", undefined);
    setEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    restoreEnv();
  });

  it("returns E2E test user when E2E_SKIP_AUTH is true in development", async () => {
    setEnv("E2E_SKIP_AUTH", "true");
    setEnv("NODE_ENV", "development");

    const request = new Request("http://localhost:7040/api/sessions");
    const result = await resolveUser(request, {
      getSession: vi.fn().mockResolvedValue(null),
      db: createMockDb(),
    });

    expect(result).toEqual({
      userId: E2E_TEST_USER_ID,
      email: E2E_TEST_USER_EMAIL,
    });
  });

  it("does NOT bypass in production even with E2E_SKIP_AUTH", async () => {
    setEnv("E2E_SKIP_AUTH", "true");
    setEnv("NODE_ENV", "production");

    const request = new Request("http://localhost:7040/api/sessions");
    const result = await resolveUser(request, {
      getSession: vi.fn().mockResolvedValue(null),
      db: createMockDb(),
    });

    expect(result).toBeNull();
  });

  it("returns session user when authenticated via cookie", async () => {
    const request = new Request("http://localhost:7040/api/sessions");
    const result = await resolveUser(request, {
      getSession: vi
        .fn()
        .mockResolvedValue({ userId: "sess-user", email: "sess@e.com" }),
      db: createMockDb(),
    });

    expect(result).toEqual({ userId: "sess-user", email: "sess@e.com" });
  });

  it("returns user from Bearer api_key when no session", async () => {
    const apiKey = "pk_" + "f".repeat(32);
    const request = new Request("http://localhost:7040/api/sessions", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const result = await resolveUser(request, {
      getSession: vi.fn().mockResolvedValue(null),
      db: createMockDb({
        getUserByApiKey: vi
          .fn()
          .mockResolvedValue({ id: "api-user", email: "api@e.com" }),
      }),
    });

    expect(result).toEqual({ userId: "api-user", email: "api@e.com" });
  });

  it("returns null when api_key lookup finds nothing", async () => {
    const request = new Request("http://localhost:7040/api/sessions", {
      headers: { Authorization: "Bearer pk_invalid" },
    });

    const result = await resolveUser(request, {
      getSession: vi.fn().mockResolvedValue(null),
      db: createMockDb(),
    });

    expect(result).toBeNull();
  });

  it("prefers session over Bearer api_key", async () => {
    const request = new Request("http://localhost:7040/api/sessions", {
      headers: { Authorization: "Bearer pk_" + "a".repeat(32) },
    });

    const db = createMockDb({
      getUserByApiKey: vi
        .fn()
        .mockResolvedValue({ id: "api-user", email: "api@e.com" }),
    });

    const result = await resolveUser(request, {
      getSession: vi
        .fn()
        .mockResolvedValue({ userId: "sess-user", email: "sess@e.com" }),
      db,
    });

    expect(result).toEqual({ userId: "sess-user", email: "sess@e.com" });
    expect(db.getUserByApiKey).not.toHaveBeenCalled();
  });

  it("returns null when no auth method succeeds", async () => {
    const request = new Request("http://localhost:7040/api/sessions");
    const result = await resolveUser(request, {
      getSession: vi.fn().mockResolvedValue(null),
      db: createMockDb(),
    });

    expect(result).toBeNull();
  });
});
