/**
 * Single source of truth for the monorepo version.
 *
 * Reads version from the root package.json via static import.
 * - Bun / Node: resolved at runtime (JSON import)
 * - Wrangler esbuild: inlined at bundle time (esbuild resolves JSON imports statically)
 * - tsc: validated via resolveJsonModule
 *
 * All packages import PIKA_VERSION from "@pika/core" instead of
 * maintaining their own version constants.
 */
import rootPkg from "../../../package.json";

export const PIKA_VERSION: string = (rootPkg as { version: string }).version;
