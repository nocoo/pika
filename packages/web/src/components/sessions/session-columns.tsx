"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/utils";
import {
  sourceLabel,
  formatDuration,
  relativeTime,
} from "@/lib/format";
import { agentColor } from "@/lib/palette";
import type { SessionCardData } from "./session-card";

// ── Star cell ────────────────────────────────────────────────

function StarCell({
  session,
  starred,
  onToggle,
}: {
  session: SessionCardData;
  starred: boolean;
  onToggle: (sessionId: string, starred: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(session.id, !starred);
      }}
      className={cn(
        "p-0.5 rounded transition-colors hover:text-amber-500",
        starred ? "text-amber-500" : "text-muted-foreground/40",
      )}
      aria-label={starred ? "Unstar session" : "Star session"}
    >
      <Star
        className="h-3.5 w-3.5"
        fill={starred ? "currentColor" : "none"}
      />
    </button>
  );
}

// ── Column definitions ───────────────────────────────────────

export function getSessionColumns(
  starredMap: Map<string, boolean>,
  onToggleStar: (sessionId: string, starred: boolean) => void,
): ColumnDef<SessionCardData, unknown>[] {
  return [
    // Star
    {
      id: "star",
      size: 40,
      enableSorting: false,
      header: () => null,
      cell: ({ row }) => {
        const session = row.original;
        const starred = starredMap.get(session.id) ?? session.is_starred === 1;
        return (
          <StarCell
            session={session}
            starred={starred}
            onToggle={onToggleStar}
          />
        );
      },
    },

    // Source
    {
      id: "source",
      enableSorting: false,
      header: "Source",
      size: 130,
      cell: ({ row }) => {
        const agent = agentColor(row.original.source);
        return (
          <Badge variant="secondary" className="gap-1.5 text-xs font-normal">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: agent.color }}
            />
            {sourceLabel(row.original.source)}
          </Badge>
        );
      },
    },

    // Title
    {
      accessorKey: "title",
      header: "Title",
      enableSorting: false,
      cell: ({ row }) => {
        const session = row.original;
        return (
          <Link
            href={`/dashboard/sessions/${session.id}`}
            className="text-sm font-medium text-foreground hover:underline truncate block max-w-[300px] xl:max-w-[400px]"
            title={session.title ?? "Untitled session"}
          >
            {session.title ?? "Untitled session"}
          </Link>
        );
      },
    },

    // Model
    {
      accessorKey: "model",
      header: "Model",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground truncate block max-w-[120px]">
          {row.original.model ?? "—"}
        </span>
      ),
    },

    // Messages (sortable)
    {
      accessorKey: "total_messages",
      header: "Msgs",
      enableSorting: true,
      size: 70,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {row.original.total_messages}
        </span>
      ),
    },

    // Tokens (sortable, hidden on mobile)
    {
      accessorKey: "total_input_tokens",
      header: "Tokens",
      enableSorting: true,
      size: 80,
      meta: {
        headerClassName: "hidden lg:table-cell",
        cellClassName: "hidden lg:table-cell",
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

    // Duration (sortable)
    {
      accessorKey: "duration_seconds",
      header: "Duration",
      enableSorting: true,
      size: 80,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDuration(row.original.duration_seconds)}
        </span>
      ),
    },

    // Last active (sortable)
    {
      accessorKey: "last_message_at",
      header: "Last active",
      enableSorting: true,
      size: 100,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {relativeTime(row.original.last_message_at)}
        </span>
      ),
    },

    // Started (sortable, hidden on mobile)
    {
      accessorKey: "started_at",
      header: "Started",
      enableSorting: true,
      size: 100,
      meta: {
        headerClassName: "hidden lg:table-cell",
        cellClassName: "hidden lg:table-cell",
      },
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {relativeTime(row.original.started_at)}
        </span>
      ),
    },
  ];
}
