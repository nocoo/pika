import type { CanonicalMessage, Source } from "@pika/core";
import { memo, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { cn, formatTokens } from "@/lib/utils";
import { MarkdownContent } from "./markdown-content";
import { MessageAvatar } from "./message-avatar";
import { ToolCall } from "./tool-call";

interface MessageBubbleProps {
  message: CanonicalMessage;
  index: number;
  source: Source;
  showTimestamp?: boolean;
  className?: string;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  index,
  source,
  showTimestamp,
  className,
}: MessageBubbleProps) {
  const { role, content, toolName, toolInput, toolResult } = message;
  const isTool = role === "tool";
  const isUser = role === "user";
  const isSystem = role === "system";
  const totalTokens = (message.inputTokens ?? 0) + (message.outputTokens ?? 0);

  const timeLabel = useMemo(() => {
    if (!message.timestamp) return null;
    const d = new Date(message.timestamp);
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }, [message.timestamp]);

  const animDelay = Math.min(index, 20) * 30;

  return (
    <div
      className={cn("flex flex-col animate-message-in", className)}
      style={{ animationDelay: `${animDelay}ms` }}
      id={`msg-${index}`}
      data-testid="message"
    >
      {showTimestamp && timeLabel && (
        <div
          className="flex items-center gap-3 py-3"
          data-testid="message-timestamp"
        >
          <div className="h-px flex-1 bg-border" />
          <span className="text-micro text-muted-foreground shrink-0">
            {timeLabel}
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )}
      {isTool && toolName && (
        <div className="ml-10 max-w-[85%]">
          <ToolCall
            toolName={toolName}
            toolInput={toolInput}
            toolResult={toolResult}
          />
        </div>
      )}
      {!isTool && (
        <div
          className={cn("flex items-start gap-3", isUser && "flex-row-reverse")}
        >
          <div className="mt-0.5 shrink-0" data-testid="message-role">
            <MessageAvatar
              role={role as "user" | "assistant" | "system"}
              source={source}
              model={message.model}
              inputTokens={message.inputTokens}
              outputTokens={message.outputTokens}
              cachedTokens={message.cachedTokens}
              timestamp={message.timestamp}
            />
          </div>

          <div
            className={cn(
              "relative max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed",
              isUser && "bg-primary text-primary-foreground",
              !isUser && !isSystem && "bg-secondary text-secondary-foreground",
              isSystem && "bg-secondary text-muted-foreground italic text-xs",
            )}
            data-testid="message-bubble"
          >
            {content && <MarkdownContent content={content} isUser={isUser} />}

            {!isTool && toolName && (
              <div className="mt-2">
                <ToolCall
                  toolName={toolName}
                  toolInput={toolInput}
                  toolResult={toolResult}
                />
              </div>
            )}

            {totalTokens > 0 && (
              <div
                className={cn(
                  "mt-1.5 flex items-center gap-2 text-micro",
                  isUser
                    ? "text-primary-foreground/60"
                    : "text-muted-foreground",
                )}
                data-testid="message-tokens"
              >
                {message.inputTokens != null && message.inputTokens > 0 && (
                  <span>{formatTokens(message.inputTokens)} in</span>
                )}
                {message.outputTokens != null && message.outputTokens > 0 && (
                  <span>{formatTokens(message.outputTokens)} out</span>
                )}
                {message.cachedTokens != null && message.cachedTokens > 0 && (
                  <span>{formatTokens(message.cachedTokens)} cached</span>
                )}
                {message.model && (
                  <Badge
                    variant="ghost"
                    className={cn(
                      "h-auto px-1 py-0 text-micro font-normal",
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

interface ContentSegment {
  type: "text" | "code";
  content: string;
  lang?: string;
}

export function parseContentSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = codeBlockRegex.exec(content);

  while (match !== null) {
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) segments.push({ type: "text", content: text });
    }

    segments.push({
      type: "code",
      content: match[2] ?? "",
      lang: match[1] || undefined,
    });

    lastIndex = match.index + match[0].length;
    match = codeBlockRegex.exec(content);
  }

  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) segments.push({ type: "text", content: text });
  }

  if (segments.length === 0 && content.trim()) {
    segments.push({ type: "text", content: content.trim() });
  }

  return segments;
}

interface InlinePart {
  text: string;
  isCode: boolean;
}

export function parseInlineCode(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const regex = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = regex.exec(text);

  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), isCode: false });
    }
    parts.push({ text: match[1] ?? "", isCode: true });
    lastIndex = match.index + match[0].length;
    match = regex.exec(text);
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isCode: false });
  }

  if (parts.length === 0 && text) {
    parts.push({ text, isCode: false });
  }

  return parts;
}
