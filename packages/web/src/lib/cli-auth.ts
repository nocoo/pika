import { API_KEY_PREFIX, API_KEY_HEX_LENGTH } from "@pika/core";

// ── Public origin resolution ───────────────────────────────────

/**
 * Resolve the public-facing origin from a request.
 *
 * Behind a TLS-terminating reverse proxy, `request.url` contains the internal
 * container URL (e.g. `http://localhost:7040`). We must use the forwarded
 * headers or AUTH_URL to construct the correct public origin so that redirects
 * and cookies work correctly.
 */
export function getPublicOrigin(request: Request): string {
  const fwdHost = request.headers.get("x-forwarded-host");
  if (fwdHost) {
    const fwdProto = request.headers.get("x-forwarded-proto") || "https";
    return `${fwdProto}://${fwdHost}`;
  }

  if (process.env.AUTH_URL) {
    return process.env.AUTH_URL;
  }

  return new URL(request.url).origin;
}

/**
 * Generate a random API key: "pk_" + 32 hex characters.
 * Accepts an optional randomBytes function for testability.
 */
export function generateApiKey(
  randomBytes?: (size: number) => Uint8Array,
): string {
  const byteLength = API_KEY_HEX_LENGTH / 2; // 16 bytes = 32 hex chars
  const bytes = randomBytes
    ? randomBytes(byteLength)
    : crypto.getRandomValues(new Uint8Array(byteLength));
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${API_KEY_PREFIX}${hex}`;
}

// ── DB interface (injectable for testability) ──────────────────

export interface CliAuthDb {
  getApiKey(userId: string): Promise<string | null>;
  setApiKey(userId: string, apiKey: string): Promise<void>;
  getUserByApiKey(apiKey: string): Promise<{ id: string; email: string } | null>;
}

// ── CLI auth handler ───────────────────────────────────────────

export interface CliAuthParams {
  callback: string | null;
  userEmail: string | null;
  userId: string | null;
}

export interface CliAuthResult {
  redirectUrl?: string;
  apiKey?: string;
  error?: string;
  status?: number;
}

/**
 * Handle CLI auth request.
 *
 * Flow:
 * 1. Validate callback param (must be localhost)
 * 2. If not authenticated → redirect to sign-in
 * 3. If authenticated → fetch or generate API key, persist to DB, redirect to callback
 */
export async function handleCliAuth(
  params: CliAuthParams,
  deps: {
    signInUrl: string;
    /** Relative path (pathname + search) — never a full URL to avoid leaking
     *  internal origins behind reverse proxies. */
    returnPath: string;
    db: CliAuthDb;
    generateKey?: () => string;
  },
): Promise<CliAuthResult> {
  const { callback, userEmail, userId } = params;

  // Not authenticated → redirect to sign-in (check before callback validation
  // so the unauthenticated redirect preserves the full URL including callback)
  if (!userId || !userEmail) {
    if (!callback) {
      return { redirectUrl: deps.signInUrl, error: "Missing callback parameter" };
    }
    const returnUrl = encodeURIComponent(deps.returnPath);
    return {
      redirectUrl: `${deps.signInUrl}?callbackUrl=${returnUrl}`,
    };
  }

  // Validate callback param
  if (!callback) {
    return { error: "Missing callback parameter", status: 400 };
  }

  let callbackUrl: URL;
  try {
    callbackUrl = new URL(callback);
  } catch {
    return { error: "Invalid callback URL", status: 400 };
  }

  // Only allow localhost callbacks (security against open redirect)
  if (
    callbackUrl.hostname !== "localhost" &&
    callbackUrl.hostname !== "127.0.0.1"
  ) {
    return { error: "Callback must be localhost", status: 400 };
  }

  // Fetch existing or generate new API key, persisting to DB
  let apiKey = await deps.db.getApiKey(userId);
  if (!apiKey) {
    apiKey = deps.generateKey ? deps.generateKey() : generateApiKey();
    await deps.db.setApiKey(userId, apiKey);
  }

  callbackUrl.searchParams.set("api_key", apiKey);
  callbackUrl.searchParams.set("email", userEmail);

  return {
    redirectUrl: callbackUrl.toString(),
    apiKey,
  };
}

// ── Auth resolution (for subsequent API calls) ─────────────────

export interface AuthResult {
  userId: string;
  email?: string;
}

/** Fixed test user for E2E mode */
export const E2E_TEST_USER_ID = "e2e-test-user-id";
export const E2E_TEST_USER_EMAIL = "e2e@test.local";

function isE2EMode(): boolean {
  return (
    process.env.E2E_SKIP_AUTH === "true" &&
    process.env.NODE_ENV === "development"
  );
}

/**
 * Resolve the authenticated user for an API request.
 *
 * Priority:
 * 1. E2E bypass (E2E_SKIP_AUTH=true in development)
 * 2. Session auth (cookie, via getSession callback)
 * 3. Bearer api_key auth (CLI uploads, via DB lookup)
 */
export async function resolveUser(
  request: Request,
  deps: {
    getSession: () => Promise<{ userId: string; email?: string } | null>;
    db: CliAuthDb;
  },
): Promise<AuthResult | null> {
  // 1. E2E bypass
  if (isE2EMode()) {
    return { userId: E2E_TEST_USER_ID, email: E2E_TEST_USER_EMAIL };
  }

  // 2. Session auth (cookie-based, browser dashboard)
  const session = await deps.getSession();
  if (session) {
    return { userId: session.userId, email: session.email };
  }

  // 3. Bearer api_key auth (CLI uploads)
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = authHeader.slice(7);
    const user = await deps.db.getUserByApiKey(apiKey);
    if (user) {
      return { userId: user.id, email: user.email };
    }
  }

  return null;
}
