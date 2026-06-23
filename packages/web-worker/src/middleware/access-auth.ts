import type { Context, Next } from "hono";
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";
import type { AppEnv } from "../lib/env";
import { isLocalhost } from "./is-localhost";

const PUBLIC_PATHS = new Set<string>(["/api/live"]);
const INGEST_BEARER_PATH_PREFIX = "/api/ingest/";

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
 * Cloudflare Access JWT verification — fail-CLOSED.
 *
 * Verified browser requests get `c.set("accessAuthenticated", true)` and
 * `c.set("accessEmail", payload.email)`.
 *
 * Routing:
 * - `/api/live` is always public.
 * - On localhost without a Bearer header we set `accessAuthenticated` so
 *   the dev-email branch in `resolveUser` can run; with a Bearer we let
 *   `apiKeyAuth` handle it (so `accessEmail` reflects the token owner).
 * - On a real edge request to `/api/ingest/*` carrying a Bearer token,
 *   we defer to `apiKeyAuth`. CLI traffic hits `/api/ingest/*` through
 *   CF Access's path-level bypass policy and therefore never carries a
 *   Cf-Access-Jwt-Assertion header — rejecting it here would break the
 *   documented CLI flow (docs/00-architecture.md §4). The Bearer escape
 *   hatch is scoped to `/api/ingest/*` so a leaked `pk_*` cannot be used
 *   to bypass CF Access on browser-only paths (`/api/me`,
 *   `/api/auth/tokens`, `/api/sessions`, …) when a request reaches the
 *   Worker directly (workers.dev / preview / custom domain misroute).
 * - For all other browser traffic: env misconfigured → 500, missing
 *   JWT → 401, invalid JWT → 403. No silent pass-through.
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

  // CLI path: CF Access bypass on `/api/ingest/*` strips the JWT but
  // forwards the Bearer header. Let `apiKeyAuth` own validation. Scoped
  // to `/api/ingest/*` so `pk_*` cannot stand in for CF Access on
  // browser-only paths if a request reaches the Worker directly.
  if (c.req.path.startsWith(INGEST_BEARER_PATH_PREFIX)) {
    const hasBearer = (c.req.header("Authorization") ?? "").startsWith(
      "Bearer ",
    );
    if (hasBearer) return next();
  }

  const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN;
  const aud = c.env.CF_ACCESS_AUD;
  if (!(teamDomain && aud)) {
    return c.json(
      {
        error:
          "Access authentication not configured. Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD.",
      },
      500,
    );
  }

  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (!jwt) return c.json({ error: "Missing Access JWT" }, 401);

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
    return c.json({ error: "Invalid Access JWT" }, 403);
  }

  return next();
}
