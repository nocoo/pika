"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ToolCall } from "./tool-call";
import type { CanonicalMessage } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: CanonicalMessage;
  index: number;
  /** Show timestamp separator before this message. */
  showTimestamp?: boolean;
  className?: string;
}

// ── MessageBubble ──────────────────────────────────────────────

export const MessageBubble = memo(function MessageBubble({
  message,
  index,
  showTimestamp,
  className,
}: MessageBubbleProps) {
  const { role, content, toolName, toolInput, toolResult } = message;
  const isTool = role === "tool";
  const isUser = role === "user";
  const isSystem = role === "system";
  const totalTokens = (message.inputTokens ?? 0) + (message.outputTokens ?? 0);

  // Format timestamp for display
  const timeLabel = useMemo(() => {
    if (!message.timestamp) return null;
    const d = new Date(message.timestamp);
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }, [message.timestamp]);

  return (
    <div className={cn("flex flex-col", className)} id={`msg-${index}`}>
      {/* Timestamp separator */}
      {showTimestamp && timeLabel && (
        <div className="flex items-center justify-center py-3">
          <span className="text-[10px] text-muted-foreground bg-background px-2">
            {timeLabel}
          </span>
        </div>
      )}

      {/* Tool call — indented, special styling */}
      {isTool && toolName && (
        <div className="ml-10 max-w-[85%]">
          <ToolCall
            toolName={toolName}
            toolInput={toolInput}
            toolResult={toolResult}
          />
        </div>
      )}

      {/* Regular message (user / assistant / system) */}
      {!isTool && (
        <div
          className={cn(
            "flex items-start gap-3",
            isUser && "flex-row-reverse",
          )}
        >
          {/* Role avatar */}
          <div
            className={cn(
              "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium",
              isUser && "bg-primary text-primary-foreground",
              !isUser && !isSystem && "bg-secondary text-secondary-foreground",
              isSystem && "bg-muted text-muted-foreground",
            )}
          >
            {isUser ? "U" : isSystem ? "S" : "A"}
          </div>

          {/* Content bubble */}
          <div
            className={cn(
              "relative max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed",
              isUser && "bg-primary text-primary-foreground",
              !isUser &&
                !isSystem &&
                "bg-secondary text-secondary-foreground",
              isSystem &&
                "bg-muted text-muted-foreground italic text-xs",
            )}
          >
            {/* Content */}
            {content && <MessageContent content={content} isUser={isUser} />}

            {/* Inline tool call on assistant message */}
            {!isTool && toolName && (
              <div className="mt-2">
                <ToolCall
                  toolName={toolName}
                  toolInput={toolInput}
                  toolResult={toolResult}
                />
              </div>
            )}

            {/* Token info */}
            {totalTokens > 0 && (
              <div
                className={cn(
                  "mt-1.5 flex items-center gap-2 text-[10px]",
                  isUser
                    ? "text-primary-foreground/60"
                    : "text-muted-foreground",
                )}
              >
                {message.inputTokens != null && message.inputTokens > 0 && (
                  <span>{formatTokens(message.inputTokens)} in</span>
                )}
                {message.outputTokens != null &&
                  message.outputTokens > 0 && (
                    <span>{formatTokens(message.outputTokens)} out</span>
                  )}
                {message.cachedTokens != null &&
                  message.cachedTokens > 0 && (
                    <span>{formatTokens(message.cachedTokens)} cached</span>
                  )}
                {message.model && (
                  <Badge
                    variant="ghost"
                    className={cn(
                      "h-auto px-1 py-0 text-[10px] font-normal",
                      isUser
                        ? "text-primary-foreground/60"
                        : "text-muted-foreground",
                    )}
                  >
                    {message.model}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

// ── MessageContent ─────────────────────────────────────────────

/** Simple content renderer — handles code blocks and inline code. */
function MessageContent({
  content,
  isUser,
}: {
  content: string;
  isUser: boolean;
}) {
  // Split content into segments: code blocks vs text
  const segments = useMemo(() => parseContentSegments(content), [content]);

  return (
    <div className="space-y-2">
      {segments.map((seg, i) =>
        seg.type === "code" ? (
          <div key={i} className="relative">
            {seg.lang && (
              <div
                className={cn(
                  "rounded-t-md px-3 py-1 text-[10px] font-mono",
                  isUser
                    ? "bg-primary-foreground/10 text-primary-foreground/70"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {seg.lang}
              </div>
            )}
            <pre
              className={cn(
                "overflow-x-auto p-3 font-mono text-xs leading-relaxed",
                seg.lang ? "rounded-b-md" : "rounded-md",
                isUser
                  ? "bg-primary-foreground/10 text-primary-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              <code>{seg.content}</code>
            </pre>
          </div>
        ) : (
          <TextBlock key={i} text={seg.content} isUser={isUser} />
        ),
      )}
    </div>
  );
}

// ── TextBlock ──────────────────────────────────────────────────

/** Renders text with inline code highlighted. */
function TextBlock({ text, isUser }: { text: string; isUser: boolean }) {
  const parts = useMemo(() => parseInlineCode(text), [text]);

  return (
    <div className="whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        part.isCode ? (
          <code
            key={i}
            className={cn(
              "rounded px-1 py-0.5 font-mono text-[13px]",
              isUser
                ? "bg-primary-foreground/15"
                : "bg-muted text-foreground",
            )}
          >
            {part.text}
          </code>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </div>
  );
}

// ── Parsing helpers ────────────────────────────────────────────

interface ContentSegment {
  type: "text" | "code";
  content: string;
  lang?: string;
}

/**
 * Split content into alternating text / fenced-code-block segments.
 * Handles ```lang\n...\n``` patterns.
 */
export function parseContentSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Text before the code block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) segments.push({ type: "text", content: text });
    }

    segments.push({
      type: "code",
      content: match[2]!,
      lang: match[1] || undefined,
    });

    lastIndex = match.index + match[0].length;
  }

  // Trailing text
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) segments.push({ type: "text", content: text });
  }

  // Fallback — no code blocks found, return as single text segment
  if (segments.length === 0 && content.trim()) {
    segments.push({ type: "text", content: content.trim() });
  }

  return segments;
}

interface InlinePart {
  text: string;
  isCode: boolean;
}

/** Split text on backtick-delimited inline code. */
export function parseInlineCode(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const regex = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), isCode: false });
    }
    parts.push({ text: match[1]!, isCode: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isCode: false });
  }

  if (parts.length === 0 && text) {
    parts.push({ text, isCode: false });
  }

  return parts;
}
