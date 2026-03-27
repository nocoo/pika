/**
 * Auto-generate session titles from project name + first user message.
 *
 * Format: `[projectName] first user message…` (80 char max, word-boundary truncation)
 */

import type { CanonicalMessage } from "./types";

const MAX_TITLE_LENGTH = 80;

/**
 * Extract the first non-empty user message content from a list of messages.
 */
export function getFirstUserMessage(
  messages: CanonicalMessage[],
): string | null {
  for (const msg of messages) {
    if (msg.role === "user" && msg.content.trim().length > 0) {
      return msg.content.trim();
    }
  }
  return null;
}

/**
 * Generate a session title from project name and first user message.
 *
 * - Returns `null` if there is no user message.
 * - With projectName: `[lastPathSegment] truncatedMessage…`
 * - Without projectName: `truncatedMessage…`
 *
 * Truncation happens at word boundaries within 80 chars total.
 */
export function generateTitle(
  projectName: string | null,
  firstUserMessage: string | null,
): string | null {
  if (!firstUserMessage) return null;

  // Normalize whitespace: collapse newlines and multiple spaces
  const normalized = firstUserMessage.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return null;

  // Build prefix from project name (last path segment)
  let prefix = "";
  if (projectName) {
    const segments = projectName.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment) {
      prefix = `[${lastSegment}] `;
    }
  }

  const budget = MAX_TITLE_LENGTH - prefix.length;
  if (budget <= 0) {
    // prefix alone exceeds budget — just use truncated message
    return truncateAtWord(normalized, MAX_TITLE_LENGTH);
  }

  const truncated = truncateAtWord(normalized, budget);
  return `${prefix}${truncated}`;
}

/**
 * Truncate text at a word boundary, appending "…" if truncated.
 */
function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;

  // Find last space within budget (leaving room for "…")
  const cutoff = maxLen - 1; // reserve 1 char for "…"
  const lastSpace = text.lastIndexOf(" ", cutoff);

  if (lastSpace > 0) {
    return `${text.slice(0, lastSpace)}…`;
  }

  // No word boundary found — hard truncate
  return `${text.slice(0, cutoff)}…`;
}
