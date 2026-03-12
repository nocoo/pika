import { describe, it, expect } from "vitest";
import { generateApiKey, handleCliAuth } from "./cli-auth.js";
import { API_KEY_PREFIX, API_KEY_HEX_LENGTH } from "@pika/core";
import { isValidApiKey } from "@pika/core";

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

describe("handleCliAuth", () => {
  const signInUrl = "/login";
  const currentUrl = "http://localhost:7040/api/auth/cli?callback=http://localhost:12345/callback";
  const defaultDeps = { signInUrl, currentUrl };

  it("returns error when callback is missing", () => {
    const result = handleCliAuth(
      { callback: null, userEmail: null, userId: null },
      defaultDeps,
    );
    expect(result.error).toBe("Missing callback parameter");
    expect(result.redirectUrl).toBe(signInUrl);
  });

  it("returns error when callback is not a valid URL", () => {
    const result = handleCliAuth(
      { callback: "not-a-url", userEmail: null, userId: null },
      defaultDeps,
    );
    expect(result.error).toBe("Invalid callback URL");
  });

  it("returns error when callback is not localhost", () => {
    const result = handleCliAuth(
      {
        callback: "http://evil.com/callback",
        userEmail: null,
        userId: null,
      },
      defaultDeps,
    );
    expect(result.error).toBe("Callback must be localhost");
  });

  it("redirects to sign-in when not authenticated", () => {
    const callback = "http://localhost:12345/callback";
    const result = handleCliAuth(
      { callback, userEmail: null, userId: null },
      defaultDeps,
    );
    expect(result.error).toBeUndefined();
    expect(result.redirectUrl).toContain(signInUrl);
    expect(result.redirectUrl).toContain("callbackUrl=");
    expect(result.redirectUrl).toContain(encodeURIComponent(currentUrl));
  });

  it("generates API key and redirects to callback when authenticated", () => {
    const callback = "http://localhost:12345/callback";
    const fixedKey = "pk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const result = handleCliAuth(
      { callback, userEmail: "user@example.com", userId: "u1" },
      { ...defaultDeps, generateKey: () => fixedKey },
    );

    expect(result.apiKey).toBe(fixedKey);
    expect(result.error).toBeUndefined();

    const url = new URL(result.redirectUrl);
    expect(url.hostname).toBe("localhost");
    expect(url.port).toBe("12345");
    expect(url.pathname).toBe("/callback");
    expect(url.searchParams.get("api_key")).toBe(fixedKey);
    expect(url.searchParams.get("email")).toBe("user@example.com");
  });

  it("allows 127.0.0.1 as callback host", () => {
    const callback = "http://127.0.0.1:54321/callback";
    const result = handleCliAuth(
      { callback, userEmail: "user@example.com", userId: "u1" },
      { ...defaultDeps, generateKey: () => "pk_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    );
    expect(result.error).toBeUndefined();
    expect(result.apiKey).toBeDefined();
    expect(result.redirectUrl).toContain("127.0.0.1:54321");
  });

  it("uses real generateApiKey when no custom generator provided", () => {
    const callback = "http://localhost:12345/callback";
    const result = handleCliAuth(
      { callback, userEmail: "user@example.com", userId: "u1" },
      defaultDeps,
    );
    expect(result.apiKey).toBeDefined();
    expect(isValidApiKey(result.apiKey!)).toBe(true);
  });
});
