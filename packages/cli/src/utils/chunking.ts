/**
 * Re-export chunking utilities from @pika/core.
 * Kept for backward compatibility with existing CLI imports.
 */
export {
  splitText,
  buildToolContext,
  chunkMessage,
  chunkMessages,
  type MessageChunk,
} from "@pika/core";
