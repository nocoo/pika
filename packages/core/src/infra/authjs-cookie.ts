/**
 * Auth.js cookie helpers shared between web (NextAuth config) and api (auth middleware).
 *
 * Cookie name MUST be derived from environment, not from request protocol —
 * a TLS-terminating reverse proxy forwards HTTP internally, so the set side
 * (HTTPS) and the read side (HTTP) would otherwise see different prefixes
 * and the session cookie would be lost.
 *
 * This module is intentionally runtime-agnostic: callers (web, api) pass in
 * the env bag explicitly so `@pika/core` does not need Node typings.
 */

const SESSION_COOKIE_SECURE = "__Secure-authjs.session-token";
const SESSION_COOKIE_INSECURE = "authjs.session-token";

export type AuthCookieEnv = {
  NODE_ENV?: string;
  AUTH_URL?: string;
  USE_SECURE_COOKIES?: string;
};

/**
 * Determine whether to use `__Secure-`-prefixed cookies.
 *
 * Mirrors the NextAuth configuration in `packages/web/src/lib/auth.ts`.
 */
export function shouldUseSecureCookies(env: AuthCookieEnv): boolean {
  return (
    env.NODE_ENV === "production" ||
    env.AUTH_URL?.startsWith("https://") === true ||
    env.USE_SECURE_COOKIES === "true"
  );
}

/**
 * The session cookie name expected for the current environment.
 * Used by the api auth middleware as the JWE decode salt.
 */
export function resolveSessionCookieName(env: AuthCookieEnv): string {
  return shouldUseSecureCookies(env)
    ? SESSION_COOKIE_SECURE
    : SESSION_COOKIE_INSECURE;
}

/**
 * Both possible cookie names. Used when the api needs to look up either
 * (host-only cookies travel as-is; the api should accept whichever the
 * proxy received).
 */
export const SESSION_COOKIE_NAMES = [
  SESSION_COOKIE_SECURE,
  SESSION_COOKIE_INSECURE,
] as const;
