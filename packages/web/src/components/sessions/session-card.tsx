"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { sourceLabel, formatDuration, relativeTime } from "@/lib/format";
import { formatTokens } from "@/lib/utils";
import { agentColor } from "@/lib/palette";
import type { Source } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

export interface SessionCardTag {
  id: string;
  name: string;
  color: string | null;
}

export interface SessionCardData {
  id: string;
  session_key: string;
  source: Source;
  started_at: string;
  last_message_at: string;
  duration_seconds: number;
  user_messages: number;
  assistant_messages: number;
  total_messages: number;
  total_input_tokens: number;
  total_output_tokens: number;
  project_ref: string | null;
  project_name: string | null;
  model: string | null;
  title: string | null;
  is_starred: number;
  tags?: SessionCardTag[];
}

interface SessionCardProps {
  session: SessionCardData;
  className?: string;
}

// ── SessionCard ────────────────────────────────────────────────

export function SessionCard({ session, className }: SessionCardProps) {
  const totalTokens = session.total_input_tokens + session.total_output_tokens;
  const agent = agentColor(session.source);
  const [starred, setStarred] = useState(session.is_starred === 1);
  const [pending, setPending] = useState(false);

  const toggleStar = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (pending) return;

      const next = !starred;
      setStarred(next); // optimistic
      setPending(true);

      try {
        const res = await fetch(`/api/sessions/${session.id}/star`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ starred: next }),
        });
        if (!res.ok) setStarred(!next); // revert on error
      } catch {
        setStarred(!next); // revert on error
      } finally {
        setPending(false);
      }
    },
    [starred, pending, session.id],
  );

  return (
    <Link
      href={`/dashboard/sessions/${session.id}`}
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30 hover:bg-accent/30",
        className,
      )}
    >
      {/* Top row: source badge + star + time */}
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleStar}
            disabled={pending}
            className={cn(
              "p-0.5 rounded transition-colors hover:text-amber-500",
              starred ? "text-amber-500" : "text-muted-foreground/40",
            )}
            aria-label={starred ? "Unstar session" : "Star session"}
          >
            <Star className="h-3.5 w-3.5" fill={starred ? "currentColor" : "none"} />
          </button>
          <span className="text-xs text-muted-foreground">
            {relativeTime(session.started_at)}
          </span>
        </div>
      </div>

      {/* Title */}
      <h3 className="text-sm font-medium text-foreground truncate">
        {session.title ?? "Untitled session"}
      </h3>

      {/* Tag badges */}
      {session.tags && session.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {session.tags.map((tag) => (
            <Badge
              key={tag.id}
              variant="outline"
              className="text-[10px] px-1.5 py-0"
              style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
            >
              {tag.name}
            </Badge>
          ))}
        </div>
      )}

      {/* Project + model */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {session.project_name && (
          <span className="truncate max-w-[200px]">
            {session.project_name}
          </span>
        )}
        {session.project_name && session.model && (
          <span className="text-border">·</span>
        )}
        {session.model && (
          <span className="truncate max-w-[150px]">{session.model}</span>
        )}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 border-t border-border">
        <span>{session.total_messages} msgs</span>
        <span>{formatDuration(session.duration_seconds)}</span>
        <span>{formatTokens(totalTokens)} tokens</span>
      </div>
    </Link>
  );
}
