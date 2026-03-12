import { API_KEY_PREFIX, API_KEY_HEX_LENGTH } from "@pika/core";

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

export interface CliAuthParams {
  callback: string | null;
  userEmail: string | null;
  userId: string | null;
}

export interface CliAuthResult {
  redirectUrl: string;
  apiKey?: string;
  error?: string;
}

/**
 * Handle CLI auth request. Returns a redirect URL.
 *
 * - If no callback param → error
 * - If not authenticated → redirect to sign-in
 * - If authenticated → generate API key and redirect to callback with key+email
 */
export function handleCliAuth(
  params: CliAuthParams,
  deps: {
    signInUrl: string;
    currentUrl: string;
    generateKey?: () => string;
  },
): CliAuthResult {
  const { callback, userEmail, userId } = params;

  if (!callback) {
    return {
      redirectUrl: deps.signInUrl,
      error: "Missing callback parameter",
    };
  }

  // Validate callback URL
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(callback);
  } catch {
    return {
      redirectUrl: deps.signInUrl,
      error: "Invalid callback URL",
    };
  }

  // Only allow localhost callbacks (security)
  if (
    callbackUrl.hostname !== "localhost" &&
    callbackUrl.hostname !== "127.0.0.1"
  ) {
    return {
      redirectUrl: deps.signInUrl,
      error: "Callback must be localhost",
    };
  }

  // Not authenticated → redirect to sign-in with return URL
  if (!userId || !userEmail) {
    const returnUrl = encodeURIComponent(deps.currentUrl);
    return {
      redirectUrl: `${deps.signInUrl}?callbackUrl=${returnUrl}`,
    };
  }

  // Authenticated → generate key and redirect to CLI callback
  const apiKey = deps.generateKey ? deps.generateKey() : generateApiKey();

  callbackUrl.searchParams.set("api_key", apiKey);
  callbackUrl.searchParams.set("email", userEmail);

  return {
    redirectUrl: callbackUrl.toString(),
    apiKey,
  };
}
