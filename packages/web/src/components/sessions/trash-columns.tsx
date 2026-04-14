"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { AgentBadge } from "@/components/ui/agent-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ModelBadge } from "@/components/ui/model-badge";
import { formatDuration, relativeTime } from "@/lib/format";
import { formatTokens } from "@/lib/utils";
import type { SessionCardData } from "./session-card";

// ── Trash-specific row type ───────────────────────────────────

export interface TrashRowData extends SessionCardData {
  deleted_at: string | null;
}

// ── Column definitions ────────────────────────────────────────

export function getTrashColumns(): ColumnDef<TrashRowData, unknown>[] {
  return [
    // Checkbox
    {
      id: "select",
      size: 40,
      enableSorting: false,
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? "indeterminate"
                : false
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },

    // Agent
    {
      id: "source",
      enableSorting: false,
      header: "Agent",
      size: 130,
      cell: ({ row }) => <AgentBadge source={row.original.source} />,
    },

    // Title (no star toggle)
    {
      accessorKey: "title",
      header: "Title",
      enableSorting: false,
      cell: ({ row }) => (
        <Link
          href={`/dashboard/sessions/${row.original.id}`}
          className="text-sm font-medium text-foreground hover:underline truncate block"
          title={row.original.title ?? "Untitled session"}
        >
          {row.original.title ?? "Untitled session"}
        </Link>
      ),
    },

    // Model
    {
      accessorKey: "model",
      header: "Model",
      enableSorting: false,
      cell: ({ row }) => <ModelBadge model={row.original.model} />,
    },

    // Messages
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

    // Tokens
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

    // Duration
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

    // Deleted at
    {
      accessorKey: "deleted_at",
      header: "Deleted",
      enableSorting: true,
      size: 100,
      meta: {
        headerClassName: "text-right",
        cellClassName: "text-right",
      },
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {row.original.deleted_at
            ? relativeTime(row.original.deleted_at)
            : "—"}
        </span>
      ),
    },
  ];
}
