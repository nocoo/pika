"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { sourceLabel, formatDuration, relativeTime } from "@/lib/format";
import { formatTokens } from "@/lib/utils";
import { agentColor } from "@/lib/palette";
import type { Source } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

interface RecentSession {
  id: string;
  source: Source;
  title: string | null;
  project_name: string | null;
  started_at: string;
  total_messages: number;
  duration_seconds: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

interface RecentSessionsProps {
  sessions: RecentSession[];
  className?: string;
}

// ── RecentSessions ─────────────────────────────────────────────

export function RecentSessions({ sessions, className }: RecentSessionsProps) {
  if (sessions.length === 0) {
    return (
      <div className={cn("flex items-center justify-center py-8 text-sm text-muted-foreground", className)}>
        No sessions yet. Run <code className="px-1.5 py-0.5 rounded bg-secondary text-xs font-mono">pika sync</code> to get started.
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col divide-y divide-border", className)}>
      {sessions.map((session) => (
        <Link
          key={session.id}
          href={`/dashboard/sessions/${session.id}`}
          className="flex items-center gap-3 py-3 px-1 transition-colors hover:bg-accent/50 rounded-lg -mx-1"
        >
          {/* Source indicator */}
          <div
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: agentColor(session.source).color }}
            title={sourceLabel(session.source)}
          />

          {/* Title + project */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {session.title ?? "Untitled session"}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {session.project_name ?? "No project"} · {sourceLabel(session.source)}
            </p>
          </div>

          {/* Stats */}
          <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground shrink-0">
            <span>{session.total_messages} msgs</span>
            <span>{formatDuration(session.duration_seconds)}</span>
            <span>{formatTokens(session.total_input_tokens + session.total_output_tokens)} tokens</span>
          </div>

          {/* Time */}
          <span className="text-xs text-muted-foreground shrink-0">
            {relativeTime(session.started_at)}
          </span>
        </Link>
      ))}
    </div>
  );
}
