"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatTokens, formatTokensFull } from "@/lib/utils";
import { sourceLabel, formatDuration, formatDate, formatDateTime } from "@/lib/format";
import { agentColor } from "@/lib/palette";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "./message-bubble";
import type { SessionDetailRow } from "@/lib/session-detail";
import type { CanonicalMessage, CanonicalSession } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

interface SessionReplayProps {
  session: SessionDetailRow;
  contentUrl: string | null;
  className?: string;
}

// ── SessionReplay ──────────────────────────────────────────────

export function SessionReplay({
  session,
  contentUrl,
  className,
}: SessionReplayProps) {
  const [messages, setMessages] = useState<CanonicalMessage[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Phase 2: fetch R2 content ──────────────────────────────

  useEffect(() => {
    if (!contentUrl) return;

    let cancelled = false;
    setLoadingContent(true);
    setContentError(null);

    (async () => {
      try {
        const res = await fetch(contentUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: CanonicalSession = await res.json();
        if (!cancelled) {
          setMessages(data.messages);
        }
      } catch (err) {
        if (!cancelled) {
          setContentError(
            err instanceof Error ? err.message : "Failed to load content",
          );
        }
      } finally {
        if (!cancelled) setLoadingContent(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [contentUrl]);

  // ── Keyboard navigation (j/k) ─────────────────────────────

  const scrollToMessage = useCallback((index: number) => {
    const el = document.getElementById(`msg-${index}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setActiveIndex(index);
    }
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture when user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => {
          const next = Math.min(prev + 1, messages.length - 1);
          scrollToMessage(next);
          return next;
        });
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => {
          const next = Math.max(prev - 1, 0);
          scrollToMessage(next);
          return next;
        });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [messages.length, scrollToMessage]);

  // ── Timestamp grouping ─────────────────────────────────────
  // Show timestamp when gap between consecutive messages > 5 minutes

  const shouldShowTimestamp = useCallback(
    (index: number): boolean => {
      if (index === 0) return true;
      const prev = messages[index - 1];
      const curr = messages[index];
      if (!prev?.timestamp || !curr?.timestamp) return false;
      const gap =
        new Date(curr.timestamp).getTime() -
        new Date(prev.timestamp).getTime();
      return gap > 5 * 60 * 1000; // 5 minutes
    },
    [messages],
  );

  // ── Render ─────────────────────────────────────────────────

  const agent = agentColor(session.source);
  const totalTokens =
    session.total_input_tokens + session.total_output_tokens;

  return (
    <div className={cn("flex flex-col gap-6", className)} ref={containerRef}>
      {/* Session header card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-3">
          {/* Top: source badge + date */}
          <div className="flex items-center justify-between">
            <Badge
              variant="secondary"
              className="gap-1.5 text-xs font-normal"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: agent.color }}
              />
              {sourceLabel(session.source)}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(session.started_at)}
            </span>
          </div>

          {/* Title */}
          <h1 className="text-xl font-semibold tracking-tight font-display">
            {session.title ?? "Untitled session"}
          </h1>

          {/* Project + model row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {session.project_name && (
              <span className="flex items-center gap-1.5">
                <svg
                  className="size-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
                  />
                </svg>
                {session.project_name}
              </span>
            )}
            {session.model && (
              <span className="flex items-center gap-1.5">
                <svg
                  className="size-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"
                  />
                </svg>
                {session.model}
              </span>
            )}
          </div>

          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <StatItem
              label="Messages"
              value={String(session.total_messages)}
            />
            <StatItem
              label="Duration"
              value={formatDuration(session.duration_seconds)}
            />
            <StatItem
              label="Tokens"
              value={formatTokensFull(totalTokens)}
              title={`In: ${formatTokensFull(session.total_input_tokens)} / Out: ${formatTokensFull(session.total_output_tokens)}${session.total_cached_tokens ? ` / Cached: ${formatTokensFull(session.total_cached_tokens)}` : ""}`}
            />
            <StatItem
              label="User"
              value={String(session.user_messages)}
            />
            <StatItem
              label="Assistant"
              value={String(session.assistant_messages)}
            />
          </div>
        </div>
      </div>

      {/* Keyboard hint */}
      {messages.length > 0 && (
        <div className="flex items-center justify-end gap-3 text-[10px] text-muted-foreground">
          <span>
            <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
              j
            </kbd>
            {" / "}
            <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
              k
            </kbd>
            {" navigate messages"}
          </span>
        </div>
      )}

      {/* Content area */}
      {loadingContent && (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="size-7 rounded-full shrink-0" />
              <Skeleton
                className={cn(
                  "h-20 rounded-xl",
                  i % 2 === 0 ? "w-3/4" : "w-1/2",
                )}
              />
            </div>
          ))}
        </div>
      )}

      {contentError && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-6 text-center text-sm text-destructive">
          Failed to load conversation: {contentError}
        </div>
      )}

      {!contentUrl && !loadingContent && (
        <div className="rounded-xl border border-border bg-secondary/30 px-4 py-12 text-center text-sm text-muted-foreground">
          No conversation content available for this session.
        </div>
      )}

      {/* Message list */}
      {messages.length > 0 && (
        <div className="flex flex-col gap-3">
          {messages.map((msg, i) => (
            <MessageBubble
              key={i}
              message={msg}
              index={i}
              showTimestamp={shouldShowTimestamp(i)}
            />
          ))}

          {/* End marker */}
          <div className="flex items-center justify-center py-6">
            <span className="text-xs text-muted-foreground">
              End of session ({messages.length} messages)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── StatItem ───────────────────────────────────────────────────

function StatItem({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="flex items-center gap-1.5" title={title}>
      <span className="text-muted-foreground/60">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
