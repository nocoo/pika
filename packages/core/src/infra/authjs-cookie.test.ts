import { describe, expect, it } from "vitest";
import {
  type AuthCookieEnv,
  resolveSessionCookieName,
  SESSION_COOKIE_NAMES,
  shouldUseSecureCookies,
} from "./authjs-cookie";

function env(overrides: AuthCookieEnv): AuthCookieEnv {
  return overrides;
}

describe("shouldUseSecureCookies", () => {
  it("returns true when NODE_ENV=production", () => {
    expect(shouldUseSecureCookies(env({ NODE_ENV: "production" }))).toBe(true);
  });

  it("returns true when AUTH_URL starts with https://", () => {
    expect(
      shouldUseSecureCookies(
        env({ NODE_ENV: "development", AUTH_URL: "https://app.example" }),
      ),
    ).toBe(true);
  });

  it("returns true when USE_SECURE_COOKIES=true", () => {
    expect(
      shouldUseSecureCookies(
        env({ NODE_ENV: "development", USE_SECURE_COOKIES: "true" }),
      ),
    ).toBe(true);
  });

  it("returns false otherwise", () => {
    expect(
      shouldUseSecureCookies(
        env({
          NODE_ENV: "development",
          AUTH_URL: "http://localhost:7022",
          USE_SECURE_COOKIES: "false",
        }),
      ),
    ).toBe(false);
  });

  it("returns false when only NODE_ENV=development is set", () => {
    expect(shouldUseSecureCookies(env({ NODE_ENV: "development" }))).toBe(
      false,
    );
  });

  it("returns false on empty env", () => {
    expect(shouldUseSecureCookies(env({}))).toBe(false);
  });
});

describe("resolveSessionCookieName", () => {
  it("returns __Secure- prefixed cookie when secure", () => {
    expect(resolveSessionCookieName(env({ NODE_ENV: "production" }))).toBe(
      "__Secure-authjs.session-token",
    );
  });

  it("returns plain cookie name when insecure", () => {
    expect(resolveSessionCookieName(env({ NODE_ENV: "development" }))).toBe(
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
