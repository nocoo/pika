import type { ColumnDef } from "@tanstack/react-table";
import { Star } from "lucide-react";
import { Link } from "react-router";
import { AgentBadge } from "@/components/ui/agent-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ModelBadge } from "@/components/ui/model-badge";
import { formatDuration, relativeTime } from "@/lib/format";
import type { SessionCardData } from "@/lib/sessions-types";
import { cn, formatTokens } from "@/lib/utils";

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
        to={`/dashboard/sessions/${session.id}`}
        className="text-sm font-medium text-foreground hover:underline truncate block"
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
        data-testid="row-star-button"
      >
        <Star
          className="h-3.5 w-3.5"
          fill={starred ? "currentColor" : "none"}
        />
      </button>
    </div>
  );
}

export function getSessionColumns(
  starredMap: Map<string, boolean>,
  onToggleStar: (sessionId: string, starred: boolean) => void,
  options?: { enableSelection?: boolean },
): ColumnDef<SessionCardData, unknown>[] {
  const cols: ColumnDef<SessionCardData, unknown>[] = [];

  if (options?.enableSelection) {
    cols.push({
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
    });
  }

  cols.push(
    {
      id: "source",
      enableSorting: false,
      header: "Agent",
      size: 130,
      cell: ({ row }) => <AgentBadge source={row.original.source} />,
    },
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
    {
      accessorKey: "model",
      header: "Model",
      enableSorting: false,
      cell: ({ row }) => <ModelBadge model={row.original.model} />,
    },
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
  );

  return cols;
}
