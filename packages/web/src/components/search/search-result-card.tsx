"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { sourceLabel, relativeTime } from "@/lib/format";
import { agentColor } from "@/lib/palette";
import type { Source } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

export interface SearchResultData {
  session_id: string;
  message_id: string;
  ordinal: number;
  chunk_index: number;
  content_snippet: string;
  tool_snippet: string | null;
  session_key: string;
  source: Source;
  project_name: string | null;
  title: string | null;
  started_at: string;
}

interface SearchResultCardProps {
  result: SearchResultData;
  className?: string;
}

// ── SearchResultCard ───────────────────────────────────────────

export function SearchResultCard({
  result,
  className,
}: SearchResultCardProps) {
  const agent = agentColor(result.source);

  return (
    <Link
      href={`/dashboard/sessions/${result.session_id}#msg-${result.ordinal}`}
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30 hover:bg-accent/30",
        className,
      )}
    >
      {/* Top: source badge + time */}
      <div className="flex items-center justify-between">
        <Badge variant="secondary" className="gap-1.5 text-xs font-normal">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: agent.color }}
          />
          {sourceLabel(result.source)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {relativeTime(result.started_at)}
        </span>
      </div>

      {/* Title + project */}
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-foreground truncate">
          {result.title ?? "Untitled session"}
        </span>
        {result.project_name && (
          <>
            <span className="text-border">·</span>
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
              {result.project_name}
            </span>
          </>
        )}
      </div>

      {/* Snippet — rendered as HTML since it contains <mark> tags from FTS5 */}
      {result.content_snippet && (
        <div
          className="text-xs text-muted-foreground leading-relaxed line-clamp-3 [&>mark]:bg-primary/20 [&>mark]:text-foreground [&>mark]:rounded-sm [&>mark]:px-0.5"
          dangerouslySetInnerHTML={{ __html: result.content_snippet }}
        />
      )}

      {/* Tool context snippet (if matched on tool_context) */}
      {result.tool_snippet && (
        <div className="border-t border-border pt-2 mt-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Tool context
          </span>
          <div
            className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-2 font-mono [&>mark]:bg-primary/20 [&>mark]:text-foreground [&>mark]:rounded-sm [&>mark]:px-0.5"
            dangerouslySetInnerHTML={{ __html: result.tool_snippet }}
          />
        </div>
      )}

      {/* Message position */}
      <div className="text-[10px] text-muted-foreground/60">
        Message #{result.ordinal + 1}
      </div>
    </Link>
  );
}
