/**
 * CliAuthDb implementation backed by Worker API.
 *
 * Instead of direct D1 access, calls Worker endpoints:
 * - setApiKey → POST /auth/cli-key (Worker generates + stores, returns plaintext)
 * - getUserByApiKey → not used (Worker auth handles this directly)
 *
 * Note: This adapter is a transitional shim. The Worker handles key generation
 * and storage atomically via /auth/cli-key. The setApiKey method here receives
 * the plaintext key from handleCliAuth but discards the hash since the Worker
 * already stored it during generation.
 */

import type { CliAuthDb } from "./cli-auth";
import { getWorkerClient, WorkerError } from "./worker-client";

export class WorkerCliAuthDb implements CliAuthDb {
  private lastGeneratedKey: string | null = null;

  /**
   * Generate an API key via Worker and store it.
   *
   * IMPORTANT: This is called by handleCliAuth AFTER it generates a key locally.
   * But we want the Worker to generate the key. So we use a two-step approach:
   * 1. generateKeyViaWorker() is called first to get the key from Worker
   * 2. setApiKey() is then called by handleCliAuth but we no-op since Worker already stored it
   */
  async setApiKey(_userId: string, _hashedKey: string): Promise<void> {
    // No-op: Worker /auth/cli-key already stored the key during generation.
    // The hash passed here was computed from the Worker-generated key,
    // which the Worker already hashed and stored.
    // We keep this method for interface compatibility but it does nothing.
    if (!this.lastGeneratedKey) {
      throw new Error(
        "WorkerCliAuthDb.setApiKey called without prior generateKeyViaWorker call",
      );
    }
    // Reset state
    this.lastGeneratedKey = null;
  }

  /**
   * Look up user by API key hash.
   *
   * This is used by resolveUser for CLI auth. Since the Worker handles this
   * via its own auth middleware, this method is not called in the Worker-based
   * flow. It's here for interface compatibility.
   *
   * For now, throw an error to catch any unexpected usage.
   */
  async getUserByApiKey(
    _hashedKey: string,
  ): Promise<{ id: string; email: string } | null> {
    // This should not be called in the Worker-based flow.
    // The Worker validates API keys via its own auth middleware.
    throw new Error(
      "WorkerCliAuthDb.getUserByApiKey is not supported. " +
        "Use WorkerClient for authenticated requests instead.",
    );
  }

  /**
   * Generate an API key via Worker.
   *
   * Calls POST /auth/cli-key with WORKER_SECRET auth.
   * Worker generates, hashes, stores, and returns the plaintext key.
   *
   * @param userId - The authenticated user's ID
   * @returns The plaintext API key (pk_...)
   */
  async generateKeyViaWorker(userId: string): Promise<string> {
    const client = getWorkerClient();
    const result = await client.generateCliKey(userId);
    this.lastGeneratedKey = result.apiKey;
    return result.apiKey;
  }
}

/**
 * Create a WorkerCliAuthDb and generate a key via Worker.
 *
 * This is a helper that combines the adapter with key generation,
 * designed to integrate with handleCliAuth's generateKey option.
 *
 * Usage:
 * ```
 * const db = new WorkerCliAuthDb();
 * const apiKey = await db.generateKeyViaWorker(userId);
 * // Now call handleCliAuth with generateKey: () => apiKey
 * ```
 */
export async function generateCliKeyViaWorker(userId: string): Promise<{
  db: WorkerCliAuthDb;
  apiKey: string;
}> {
  const db = new WorkerCliAuthDb();
  try {
    const apiKey = await db.generateKeyViaWorker(userId);
    return { db, apiKey };
  } catch (err) {
    if (err instanceof WorkerError && err.status === 404) {
      throw new Error(
        `User ${userId} not found. OAuth sign-in may not have persisted the user row.`,
      );
    }
    throw err;
  }
}
