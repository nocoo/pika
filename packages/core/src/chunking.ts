/**
 * Message chunking utility.
 *
 * Splits CanonicalMessage content at natural boundaries (~2000 chars)
 * for FTS5 indexing in D1 (message_chunks + chunks_fts).
 *
 * Boundary priority (try each in order):
 * 1. Paragraph break (double newline)
 * 2. Single newline
 * 3. Sentence end (. ! ? followed by space or end)
 * 4. Space (word boundary)
 * 5. Hard cut at MAX_CHUNK_SIZE (last resort)
 *
 * For tool messages (role=tool), chunk_index=0 gets a `tool_context`
 * string combining toolName + toolInput for FTS discoverability.
 */

import { MAX_CHUNK_SIZE } from "./constants.js";
import type { CanonicalMessage } from "./types.js";

// ── Types ──────────────────────────────────────────────────────

export interface MessageChunk {
  /** Zero-based chunk index within the message */
  chunkIndex: number;
  /** Chunk content (≤ MAX_CHUNK_SIZE characters) */
  content: string;
  /** Tool context (toolName + toolInput) — only on chunk_index=0 for tool messages */
  toolContext: string | null;
}

// ── Chunking ───────────────────────────────────────────────────

/**
 * Find the best split position in text up to maxLen.
 * Tries natural boundaries in priority order.
 * Returns the split position (exclusive end of first chunk).
 */
function findSplitPosition(text: string, maxLen: number): number {
  // If text fits, return full length
  if (text.length <= maxLen) return text.length;

  const searchRegion = text.slice(0, maxLen);

  // 1. Paragraph break (double newline)
  const paraBreak = searchRegion.lastIndexOf("\n\n");
  if (paraBreak > 0) return paraBreak + 2; // include the double newline

  // 2. Single newline
  const newline = searchRegion.lastIndexOf("\n");
  if (newline > 0) return newline + 1; // include the newline

  // 3. Sentence end (. ! ? followed by space or at end of search region)
  for (let i = maxLen - 1; i > 0; i--) {
    const ch = searchRegion[i];
    if (ch === "." || ch === "!" || ch === "?") {
      // Check if next char is space, newline, or end of searchRegion
      if (i + 1 >= searchRegion.length || searchRegion[i + 1] === " " || searchRegion[i + 1] === "\n") {
        return i + 1;
      }
    }
  }

  // 4. Space (word boundary)
  const space = searchRegion.lastIndexOf(" ");
  if (space > 0) return space + 1; // include space in first chunk

  // 5. Hard cut
  return maxLen;
}

/**
 * Split a text string into chunks of at most MAX_CHUNK_SIZE characters,
 * preferring natural boundaries.
 */
export function splitText(text: string, maxChunkSize = MAX_CHUNK_SIZE): string[] {
  if (!text) return [""];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const splitAt = findSplitPosition(remaining, maxChunkSize);
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

// ── Tool context ───────────────────────────────────────────────

/**
 * Build tool_context string from a tool message.
 * Combines toolName and toolInput for FTS discoverability.
 * Returns null for non-tool messages or tool messages without metadata.
 */
export function buildToolContext(msg: CanonicalMessage): string | null {
  if (msg.role !== "tool") return null;
  if (!msg.toolName && !msg.toolInput) return null;

  const parts: string[] = [];
  if (msg.toolName) parts.push(`tool:${msg.toolName}`);
  if (msg.toolInput) parts.push(msg.toolInput);
  return parts.join(" ");
}

// ── Main entry ─────────────────────────────────────────────────

/**
 * Chunk a CanonicalMessage into MessageChunk[].
 *
 * - Content is split at natural boundaries (~MAX_CHUNK_SIZE chars)
 * - chunk_index=0 gets tool_context for tool messages
 * - Non-tool messages always have tool_context=null
 */
export function chunkMessage(
  msg: CanonicalMessage,
  maxChunkSize = MAX_CHUNK_SIZE,
): MessageChunk[] {
  const textChunks = splitText(msg.content, maxChunkSize);
  const toolContext = buildToolContext(msg);

  return textChunks.map((content, i) => ({
    chunkIndex: i,
    content,
    toolContext: i === 0 ? toolContext : null,
  }));
}

/**
 * Chunk all messages in a session into a flat array of MessageChunk[],
 * each tagged with the message's ordinal index.
 */
export function chunkMessages(
  messages: CanonicalMessage[],
  maxChunkSize = MAX_CHUNK_SIZE,
): Array<MessageChunk & { ordinal: number }> {
  const result: Array<MessageChunk & { ordinal: number }> = [];

  for (let i = 0; i < messages.length; i++) {
    const chunks = chunkMessage(messages[i], maxChunkSize);
    for (const chunk of chunks) {
      result.push({ ...chunk, ordinal: i });
    }
  }

  return result;
}
