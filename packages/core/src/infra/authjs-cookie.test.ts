import { describe, expect, it } from "vitest";
import {
  resolveSessionCookieName,
  SESSION_COOKIE_NAMES,
  shouldUseSecureCookies,
} from "./authjs-cookie";

const KEYS = ["NODE_ENV", "AUTH_URL", "USE_SECURE_COOKIES"] as const;

function withEnv(
  overrides: Partial<Record<(typeof KEYS)[number], string | undefined>>,
) {
  return overrides as NodeJS.ProcessEnv;
}

describe("shouldUseSecureCookies", () => {
  it("returns true when NODE_ENV=production", () => {
    expect(shouldUseSecureCookies(withEnv({ NODE_ENV: "production" }))).toBe(
      true,
    );
  });

  it("returns true when AUTH_URL starts with https://", () => {
    expect(
      shouldUseSecureCookies(
        withEnv({ NODE_ENV: "development", AUTH_URL: "https://app.example" }),
      ),
    ).toBe(true);
  });

  it("returns true when USE_SECURE_COOKIES=true", () => {
    expect(
      shouldUseSecureCookies(
        withEnv({ NODE_ENV: "development", USE_SECURE_COOKIES: "true" }),
      ),
    ).toBe(true);
  });

  it("returns false otherwise", () => {
    expect(
      shouldUseSecureCookies(
        withEnv({
          NODE_ENV: "development",
          AUTH_URL: "http://localhost:7022",
          USE_SECURE_COOKIES: "false",
        }),
      ),
    ).toBe(false);
  });

  it("returns false when AUTH_URL is undefined and not production", () => {
    expect(shouldUseSecureCookies(withEnv({ NODE_ENV: "development" }))).toBe(
      false,
    );
  });

  it("defaults to process.env when no env passed", () => {
    const original = process.env.NODE_ENV;
    const originalAuthUrl = process.env.AUTH_URL;
    const originalUse = process.env.USE_SECURE_COOKIES;
    try {
      (process.env as Record<string, string>).NODE_ENV = "production";
      delete (process.env as Record<string, string | undefined>).AUTH_URL;
      delete (process.env as Record<string, string | undefined>)
        .USE_SECURE_COOKIES;
      expect(shouldUseSecureCookies()).toBe(true);
    } finally {
      if (original === undefined) {
        delete (process.env as Record<string, string | undefined>).NODE_ENV;
      } else {
        (process.env as Record<string, string>).NODE_ENV = original;
      }
      if (originalAuthUrl !== undefined) process.env.AUTH_URL = originalAuthUrl;
      if (originalUse !== undefined)
        process.env.USE_SECURE_COOKIES = originalUse;
    }
  });
});

describe("resolveSessionCookieName", () => {
  it("returns __Secure- prefixed cookie when secure", () => {
    expect(resolveSessionCookieName(withEnv({ NODE_ENV: "production" }))).toBe(
      "__Secure-authjs.session-token",
    );
  });

  it("returns plain cookie name when insecure", () => {
    expect(resolveSessionCookieName(withEnv({ NODE_ENV: "development" }))).toBe(
      "authjs.session-token",
    );
  });
});

describe("SESSION_COOKIE_NAMES", () => {
  it("lists both secure and insecure variants", () => {
    expect(SESSION_COOKIE_NAMES).toEqual([
      "__Secure-authjs.session-token",
      "authjs.session-token",
    ]);
  });
});
