/**
 * Get the authenticated user for server components.
 * Supports E2E bypass mode for Playwright tests.
 */

import { auth } from "./auth";
import { E2E_TEST_USER_EMAIL, E2E_TEST_USER_ID } from "./cli-auth";

export interface SessionUser {
  id: string;
  email?: string;
  name?: string;
}

/**
 * Check if running in E2E test mode.
 */
function isE2EMode(): boolean {
  return (
    process.env.E2E_SKIP_AUTH === "true" &&
    process.env.NODE_ENV === "development"
  );
}

/**
 * Get the authenticated user for server components.
 * Returns null if not authenticated.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  // E2E bypass
  if (isE2EMode()) {
    return {
      id: E2E_TEST_USER_ID,
      email: E2E_TEST_USER_EMAIL,
      name: "E2E Test User",
    };
  }

  // Normal auth
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email ?? undefined,
    name: session.user.name ?? undefined,
  };
}
