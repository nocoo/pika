import type { Context, Next } from "hono";
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";
import type { AppEnv } from "../lib/env";
import { isLocalhost } from "./is-localhost";

const PUBLIC_PATHS = new Set<string>(["/api/live"]);

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksCacheTeamDomain: string | null = null;

function getJWKS(teamDomain: string) {
  if (jwksCache && jwksCacheTeamDomain === teamDomain) return jwksCache;
  jwksCache = createRemoteJWKSet(
    new URL(`https://${teamDomain}/cdn-cgi/access/certs`),
  );
  jwksCacheTeamDomain = teamDomain;
  return jwksCache;
}

/**
 * For tests only — reset the module-level JWKS cache so each test starts
 * from a clean slate.
 */
export function __resetAccessAuthCacheForTests() {
  jwksCache = null;
  jwksCacheTeamDomain = null;
}

/**
 * Cloudflare Access JWT verification.
 *
 * Verified requests get `c.set("accessAuthenticated", true)` and
 * `c.set("accessEmail", payload.email)`.
 *
 * - `/api/live` is always public.
 * - On localhost without a Bearer header we set `accessAuthenticated` so
 *   the dev-email branch in `resolveUser` can run; with a Bearer we let
 *   `apiKeyAuth` handle it (so `accessEmail` reflects the token owner).
 * - JWT failure does NOT 401 here — fall through to `apiKeyAuth`.
 */
export async function accessAuth(c: Context<AppEnv>, next: Next) {
  if (PUBLIC_PATHS.has(c.req.path)) return next();

  if (isLocalhost(c)) {
    const hasBearer = (c.req.header("Authorization") ?? "").startsWith(
      "Bearer ",
    );
    if (!hasBearer) {
      c.set("accessAuthenticated", true);
      // Dev-only email injection so resolveUser can hydrate a real userId
      // against prod D1 (`experimental_remote=true`). Configured via
      // packages/web-worker/.dev.vars `DEV_USER_EMAIL=...` — never set in
      // prod wrangler.toml; CF Access JWT is the only email source there.
      const devEmail = c.env.DEV_USER_EMAIL;
      if (devEmail) c.set("accessEmail", devEmail);
    }
    return next();
  }

  const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN;
  const aud = c.env.CF_ACCESS_AUD;
  if (!(teamDomain && aud)) return next();

  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (!jwt) return next();

  try {
    const jwks = getJWKS(teamDomain);
    const { payload } = await jwtVerify(jwt, jwks, {
      issuer: `https://${teamDomain}`,
      audience: aud,
    });
    c.set("accessAuthenticated", true);
    const email = (payload as JWTPayload & { email?: unknown }).email;
    if (typeof email === "string") c.set("accessEmail", email);
  } catch {
    // fall through; api-key-auth or terminal 401 will handle it
  }
  return next();
}
