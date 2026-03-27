/**
 * Re-export chunking utilities from @pika/core.
 * Kept for backward compatibility with existing CLI imports.
 */
export {
  buildToolContext,
  chunkMessage,
  chunkMessages,
  type MessageChunk,
  splitText,
} from "@pika/core";
