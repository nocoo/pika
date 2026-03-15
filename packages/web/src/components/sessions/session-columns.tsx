"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Star } from "lucide-react";
import { AgentBadge } from "@/components/ui/agent-badge";
import { ModelBadge } from "@/components/ui/model-badge";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/utils";
import {
  formatDuration,
  relativeTime,
} from "@/lib/format";
import type { SessionCardData } from "./session-card";

// ── Title + Star cell ────────────────────────────────────────

function TitleStarCell({
  session,
  starred,
  onToggle,
}: {
  session: SessionCardData;
  starred: boolean;
  onToggle: (sessionId: string, starred: boolean) => void;
}) {
  return (
    <div className="group flex items-center gap-1.5 min-w-0">
      <Link
        href={`/dashboard/sessions/${session.id}`}
        className="text-sm font-medium text-foreground hover:underline truncate block max-w-[300px] xl:max-w-[400px]"
        title={session.title ?? "Untitled session"}
      >
        {session.title ?? "Untitled session"}
      </Link>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle(session.id, !starred);
        }}
        className={cn(
          "shrink-0 p-0.5 rounded transition-colors hover:text-amber-500",
          starred
            ? "text-amber-500"
            : "text-muted-foreground/40 opacity-0 group-hover:opacity-100",
        )}
        aria-label={starred ? "Unstar session" : "Star session"}
      >
        <Star
          className="h-3.5 w-3.5"
          fill={starred ? "currentColor" : "none"}
        />
      </button>
    </div>
  );
}

// ── Column definitions ───────────────────────────────────────

export function getSessionColumns(
  starredMap: Map<string, boolean>,
  onToggleStar: (sessionId: string, starred: boolean) => void,
): ColumnDef<SessionCardData, unknown>[] {
  return [
    // Agent (was "Source")
    {
      id: "source",
      enableSorting: false,
      header: "Agent",
      size: 130,
      cell: ({ row }) => <AgentBadge source={row.original.source} />,
    },

    // Title (with inline star on hover)
    {
      accessorKey: "title",
      header: "Title",
      enableSorting: false,
      cell: ({ row }) => {
        const session = row.original;
        const starred = starredMap.get(session.id) ?? session.is_starred === 1;
        return (
          <TitleStarCell
            session={session}
            starred={starred}
            onToggle={onToggleStar}
          />
        );
      },
    },

    // Model (badge with tinted color)
    {
      accessorKey: "model",
      header: "Model",
      enableSorting: false,
      cell: ({ row }) => <ModelBadge model={row.original.model} />,
    },

    // Messages (sortable, right-aligned)
    {
      accessorKey: "total_messages",
      header: "Messages",
      enableSorting: true,
      size: 90,
      meta: {
        headerClassName: "text-right",
        cellClassName: "text-right",
      },
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {row.original.total_messages}
        </span>
      ),
    },

    // Tokens (sortable, right-aligned, hidden on mobile)
    {
      accessorKey: "total_input_tokens",
      header: "Tokens",
      enableSorting: true,
      size: 80,
      meta: {
        headerClassName: "hidden lg:table-cell text-right",
        cellClassName: "hidden lg:table-cell text-right",
      },
      cell: ({ row }) => {
        const total =
          row.original.total_input_tokens + row.original.total_output_tokens;
        return (
          <span className="text-sm text-muted-foreground tabular-nums">
            {formatTokens(total)}
          </span>
        );
      },
    },

    // Duration (sortable, right-aligned)
    {
      accessorKey: "duration_seconds",
      header: "Duration",
      enableSorting: true,
      size: 80,
      meta: {
        headerClassName: "text-right",
        cellClassName: "text-right",
      },
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDuration(row.original.duration_seconds)}
        </span>
      ),
    },

    // Last active (sortable, right-aligned)
    {
      accessorKey: "last_message_at",
      header: "Last active",
      enableSorting: true,
      size: 100,
      meta: {
        headerClassName: "text-right",
        cellClassName: "text-right",
      },
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {relativeTime(row.original.last_message_at)}
        </span>
      ),
    },

    // Started (sortable, right-aligned, hidden on mobile)
    {
      accessorKey: "started_at",
      header: "Started",
      enableSorting: true,
      size: 100,
      meta: {
        headerClassName: "hidden lg:table-cell text-right",
        cellClassName: "hidden lg:table-cell text-right",
      },
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {relativeTime(row.original.started_at)}
        </span>
      ),
    },
  ];
}
