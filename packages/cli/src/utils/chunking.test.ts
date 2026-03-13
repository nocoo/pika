import { describe, it, expect } from "vitest";
import {
  splitText,
  buildToolContext,
  chunkMessage,
  chunkMessages,
} from "./chunking";
import type { CanonicalMessage } from "@pika/core";
import { MAX_CHUNK_SIZE } from "@pika/core";

// ── splitText ──────────────────────────────────────────────────

describe("splitText", () => {
  it("returns single chunk for short text", () => {
    const chunks = splitText("Hello, world!");
    expect(chunks).toEqual(["Hello, world!"]);
  });

  it("returns [''] for empty string", () => {
    const chunks = splitText("");
    expect(chunks).toEqual([""]);
  });

  it("returns single chunk for text exactly at max size", () => {
    const text = "x".repeat(MAX_CHUNK_SIZE);
    const chunks = splitText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it("splits at paragraph boundary (double newline)", () => {
    const para1 = "a".repeat(1500);
    const para2 = "b".repeat(1500);
    const text = `${para1}\n\n${para2}`;
    const chunks = splitText(text);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(`${para1}\n\n`);
    expect(chunks[1]).toBe(para2);
  });

  it("splits at single newline when no paragraph break", () => {
    const line1 = "a".repeat(1500);
    const line2 = "b".repeat(1500);
    const text = `${line1}\n${line2}`;
    const chunks = splitText(text);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(`${line1}\n`);
    expect(chunks[1]).toBe(line2);
  });

  it("splits at sentence boundary", () => {
    // sentence1 = 1999 "a"s + "." = 2000 chars, sentence2 = " " + 400 "b"s = 401 chars
    // total = 2401 > MAX_CHUNK_SIZE → triggers split
    const sentence1 = "a".repeat(1999) + ".";
    const sentence2 = " " + "b".repeat(400);
    const text = sentence1 + sentence2;
    const chunks = splitText(text);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(sentence1);
    expect(chunks[1]).toBe(sentence2);
  });

  it("splits at sentence end with exclamation", () => {
    const sentence1 = "a".repeat(1999) + "!";
    const sentence2 = " " + "b".repeat(400);
    const text = sentence1 + sentence2;
    const chunks = splitText(text);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(sentence1);
  });

  it("splits at sentence end with question mark", () => {
    const sentence1 = "a".repeat(1999) + "?";
    const sentence2 = " " + "b".repeat(400);
    const text = sentence1 + sentence2;
    const chunks = splitText(text);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(sentence1);
  });

  it("does not split at period in middle of word (e.g. filename)", () => {
    // "file.txt" has a dot but next char is "t" (not space/end) — should not split at the dot
    // total = 1995 + 8 = 2003 > 2000, no newlines/spaces → hard cut at 2000
    const text = "a".repeat(1995) + "file.txt";
    const chunks = splitText(text);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(MAX_CHUNK_SIZE);
  });

  it("splits at space when no sentence boundary", () => {
    const words = "word ".repeat(500); // 2500 chars, spaces every 5
    const chunks = splitText(words);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should end at a word boundary (space)
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i].length).toBeLessThanOrEqual(MAX_CHUNK_SIZE);
    }
  });

  it("hard-cuts when no natural boundary exists", () => {
    const text = "x".repeat(5000); // no spaces, no newlines
    const chunks = splitText(text);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(MAX_CHUNK_SIZE);
    expect(chunks[1]).toHaveLength(MAX_CHUNK_SIZE);
    expect(chunks[2]).toHaveLength(1000);
  });

  it("handles multiple chunks correctly", () => {
    const text = Array.from({ length: 5 }, (_, i) => `Para ${i + 1}: ${"x".repeat(1800)}`).join("\n\n");
    const chunks = splitText(text);
    // Verify all content is preserved
    expect(chunks.join("")).toBe(text);
    // Each chunk should be within limits
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_SIZE);
    }
  });

  it("respects custom maxChunkSize", () => {
    const text = "Hello world, this is a test sentence.";
    const chunks = splitText(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20);
    }
  });

  it("preserves exact content after joining chunks", () => {
    const text = "The quick brown fox jumps over the lazy dog.\n\nSecond paragraph here with more text.\nThird line.\n\nFinal paragraph.";
    const chunks = splitText(text, 50);
    expect(chunks.join("")).toBe(text);
  });

  it("handles text with only newlines", () => {
    const text = "\n".repeat(3000);
    const chunks = splitText(text);
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_SIZE);
    }
  });

  it("handles text with only spaces", () => {
    const text = " ".repeat(3000);
    const chunks = splitText(text);
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_SIZE);
    }
  });

  it("paragraph boundary takes precedence over newline", () => {
    // Both \n\n and \n exist — should split at \n\n
    const before = "a".repeat(800);
    const mid = "b".repeat(500);
    const after = "c".repeat(800);
    const text = `${before}\n${mid}\n\n${after}`;
    // Total: 800 + 1 + 500 + 2 + 800 = 2103. Split point should be at \n\n (pos 1303)
    const chunks = splitText(text);
    expect(chunks[0]).toBe(`${before}\n${mid}\n\n`);
    expect(chunks[1]).toBe(after);
  });
});

// ── buildToolContext ───────────────────────────────────────────

describe("buildToolContext", () => {
  it("returns null for user messages", () => {
    const msg: CanonicalMessage = {
      role: "user",
      content: "Hello",
      timestamp: "2026-01-01T00:00:00Z",
    };
    expect(buildToolContext(msg)).toBeNull();
  });

  it("returns null for assistant messages", () => {
    const msg: CanonicalMessage = {
      role: "assistant",
      content: "Hi",
      timestamp: "2026-01-01T00:00:00Z",
    };
    expect(buildToolContext(msg)).toBeNull();
  });

  it("returns null for system messages", () => {
    const msg: CanonicalMessage = {
      role: "system",
      content: "System prompt",
      timestamp: "2026-01-01T00:00:00Z",
    };
    expect(buildToolContext(msg)).toBeNull();
  });

  it("returns null for tool messages without toolName or toolInput", () => {
    const msg: CanonicalMessage = {
      role: "tool",
      content: "Result",
      timestamp: "2026-01-01T00:00:00Z",
    };
    expect(buildToolContext(msg)).toBeNull();
  });

  it("returns toolName for tool messages with only toolName", () => {
    const msg: CanonicalMessage = {
      role: "tool",
      content: "Result",
      toolName: "read_file",
      timestamp: "2026-01-01T00:00:00Z",
    };
    expect(buildToolContext(msg)).toBe("tool:read_file");
  });

  it("returns toolInput for tool messages with only toolInput", () => {
    const msg: CanonicalMessage = {
      role: "tool",
      content: "Result",
      toolInput: '{"path":"/src/index.ts"}',
      timestamp: "2026-01-01T00:00:00Z",
    };
    expect(buildToolContext(msg)).toBe('{"path":"/src/index.ts"}');
  });

  it("returns combined toolName + toolInput", () => {
    const msg: CanonicalMessage = {
      role: "tool",
      content: "File content here",
      toolName: "read_file",
      toolInput: '{"path":"/src/index.ts"}',
      timestamp: "2026-01-01T00:00:00Z",
    };
    expect(buildToolContext(msg)).toBe('tool:read_file {"path":"/src/index.ts"}');
  });
});

// ── chunkMessage ───────────────────────────────────────────────

describe("chunkMessage", () => {
  it("returns single chunk for short message", () => {
    const msg: CanonicalMessage = {
      role: "user",
      content: "Hello",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const chunks = chunkMessage(msg);
    expect(chunks).toEqual([
      { chunkIndex: 0, content: "Hello", toolContext: null },
    ]);
  });

  it("splits long message into multiple chunks", () => {
    const msg: CanonicalMessage = {
      role: "assistant",
      content: "x".repeat(5000),
      timestamp: "2026-01-01T00:00:00Z",
    };
    const chunks = chunkMessage(msg);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[1].chunkIndex).toBe(1);
    expect(chunks[2].chunkIndex).toBe(2);
  });

  it("sets tool_context on chunk_index=0 for tool messages", () => {
    const msg: CanonicalMessage = {
      role: "tool",
      content: "x".repeat(5000),
      toolName: "read_file",
      toolInput: '{"path":"/src/index.ts"}',
      timestamp: "2026-01-01T00:00:00Z",
    };
    const chunks = chunkMessage(msg);
    expect(chunks[0].toolContext).toBe('tool:read_file {"path":"/src/index.ts"}');
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].toolContext).toBeNull();
    }
  });

  it("sets tool_context=null for non-tool messages", () => {
    const msg: CanonicalMessage = {
      role: "user",
      content: "Hello",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const chunks = chunkMessage(msg);
    expect(chunks[0].toolContext).toBeNull();
  });

  it("handles empty content", () => {
    const msg: CanonicalMessage = {
      role: "user",
      content: "",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const chunks = chunkMessage(msg);
    expect(chunks).toEqual([
      { chunkIndex: 0, content: "", toolContext: null },
    ]);
  });

  it("respects custom maxChunkSize", () => {
    const msg: CanonicalMessage = {
      role: "assistant",
      content: "Hello world, testing",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const chunks = chunkMessage(msg, 10);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(10);
    }
  });
});

// ── chunkMessages ──────────────────────────────────────────────

describe("chunkMessages", () => {
  it("returns empty array for empty messages", () => {
    expect(chunkMessages([])).toEqual([]);
  });

  it("assigns correct ordinal to each message's chunks", () => {
    const messages: CanonicalMessage[] = [
      { role: "user", content: "Hello", timestamp: "2026-01-01T00:00:00Z" },
      { role: "assistant", content: "Hi!", timestamp: "2026-01-01T00:00:05Z" },
    ];
    const chunks = chunkMessages(messages);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].ordinal).toBe(0);
    expect(chunks[1].ordinal).toBe(1);
  });

  it("handles multi-chunk messages with correct ordinals", () => {
    const messages: CanonicalMessage[] = [
      { role: "user", content: "Short", timestamp: "2026-01-01T00:00:00Z" },
      { role: "assistant", content: "x".repeat(5000), timestamp: "2026-01-01T00:00:05Z" },
      { role: "user", content: "Another short", timestamp: "2026-01-01T00:05:00Z" },
    ];
    const chunks = chunkMessages(messages);
    // msg 0: 1 chunk, msg 1: 3 chunks, msg 2: 1 chunk = 5 total
    expect(chunks).toHaveLength(5);
    expect(chunks[0].ordinal).toBe(0);
    expect(chunks[1].ordinal).toBe(1);
    expect(chunks[1].chunkIndex).toBe(0);
    expect(chunks[2].ordinal).toBe(1);
    expect(chunks[2].chunkIndex).toBe(1);
    expect(chunks[3].ordinal).toBe(1);
    expect(chunks[3].chunkIndex).toBe(2);
    expect(chunks[4].ordinal).toBe(2);
  });

  it("preserves tool_context in multi-message chunking", () => {
    const messages: CanonicalMessage[] = [
      { role: "user", content: "Read this file", timestamp: "2026-01-01T00:00:00Z" },
      {
        role: "tool",
        content: "x".repeat(3000),
        toolName: "read_file",
        toolInput: '{"path":"src/a.ts"}',
        timestamp: "2026-01-01T00:00:05Z",
      },
    ];
    const chunks = chunkMessages(messages);
    // msg 0: 1 chunk (user), msg 1: 2 chunks (tool)
    expect(chunks[0].toolContext).toBeNull(); // user msg
    expect(chunks[1].toolContext).toBe('tool:read_file {"path":"src/a.ts"}'); // tool chunk 0
    expect(chunks[2].toolContext).toBeNull(); // tool chunk 1
  });
});
