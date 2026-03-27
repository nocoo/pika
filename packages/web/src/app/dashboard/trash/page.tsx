"use client";

import {
  getCoreRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getTrashColumns,
  type TrashRowData,
} from "@/components/sessions/trash-columns";
import { DataTable } from "@/components/ui/data-table";
import {
  type BulkAction,
  DataTableBulkBar,
  TRASH_BULK_ACTIONS,
} from "@/components/ui/data-table-bulk-bar";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import type { SessionListResponse, SessionSort } from "@/lib/sessions";

// ── Sort mapping ─────────────────────────────────────────────

const COLUMN_TO_SORT: Record<string, SessionSort> = {
  total_messages: "total_messages",
  total_input_tokens: "total_input_tokens",
  duration_seconds: "duration_seconds",
  last_message_at: "last_message_at",
  started_at: "started_at",
};

const SORT_TO_COLUMN: Record<SessionSort, string> = {
  total_messages: "total_messages",
  total_input_tokens: "total_input_tokens",
  duration_seconds: "duration_seconds",
  last_message_at: "last_message_at",
  started_at: "started_at",
};

// ── Page component ───────────────────────────────────────────

export default function TrashPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<SessionSort>("last_message_at");
  const [sessions, setSessions] = useState<TrashRowData[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Row selection
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [selectAllMode, setSelectAllMode] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  const selectedCount = Object.keys(rowSelection).length;

  // Sorting state
  const sorting: SortingState = useMemo(() => {
    const columnId = SORT_TO_COLUMN[sort];
    return columnId ? [{ id: columnId, desc: true }] : [];
  }, [sort]);

  const onSortingChange = useCallback(
    (updaterOrValue: SortingState | ((old: SortingState) => SortingState)) => {
      const newSorting =
        typeof updaterOrValue === "function"
          ? updaterOrValue(sorting)
          : updaterOrValue;

      if (newSorting.length > 0) {
        const apiSort = COLUMN_TO_SORT[newSorting[0]?.id];
        if (apiSort) {
          setSort(apiSort);
          setPage(1);
        }
      }
    },
    [sorting],
  );

  // Columns
  const columns = useMemo(() => getTrashColumns(), []);

  // Table instance
  const table = useReactTable({
    data: sessions,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    state: { sorting, rowSelection },
    onSortingChange,
    onRowSelectionChange: (updater) => {
      setSelectAllMode(false);
      setRowSelection(updater);
    },
    enableRowSelection: true,
    enableSortingRemoval: false,
    getRowId: (row) => row.id,
  });

  // Fetch deleted sessions
  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        deleted: "true",
        sort,
        page: String(page),
        limit: String(pageSize),
      });

      const res = await fetch(`/api/sessions?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SessionListResponse = await res.json();
      setSessions(data.sessions as unknown as TrashRowData[]);
      setTotalCount(data.totalCount ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trash");
    } finally {
      setLoading(false);
    }
  }, [sort, page, pageSize]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Clear selection when page/sort changes
  useEffect(() => {
    setRowSelection({});
    setSelectAllMode(false);
  }, []);

  // Batch action handler
  const handleBulkAction = useCallback(
    async (action: BulkAction) => {
      setBulkLoading(true);
      try {
        const body: Record<string, unknown> = { action };

        if (selectAllMode) {
          body.filter = { deleted: true };
        } else {
          body.ids = Object.keys(rowSelection);
        }

        const res = await fetch("/api/sessions/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res
            .json()
            .catch(() => ({ error: "Unknown error" }));
          setError(
            (err as { error: string }).error ?? "Batch operation failed",
          );
          return;
        }

        setRowSelection({});
        setSelectAllMode(false);
        await fetchSessions();
      } catch {
        setError("Batch operation failed");
      } finally {
        setBulkLoading(false);
      }
    },
    [selectAllMode, rowSelection, fetchSessions],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight font-display">
          Trash
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Deleted sessions. Restore them or they stay here until permanently
          removed.
        </p>
      </div>

      {/* Bulk action bar */}
      <DataTableBulkBar
        selectedCount={selectedCount}
        totalCount={totalCount}
        selectAllMode={selectAllMode}
        onSelectAll={() => setSelectAllMode(true)}
        onClearSelection={() => {
          setRowSelection({});
          setSelectAllMode(false);
        }}
        onAction={handleBulkAction}
        actions={TRASH_BULK_ACTIONS}
        loading={bulkLoading}
      />

      {/* Error state */}
      {error && <div className="text-sm text-destructive py-4">{error}</div>}

      {/* Data table */}
      <DataTable
        table={table}
        columns={columns}
        loading={loading}
        emptyMessage="Trash is empty."
      />

      {/* Pagination */}
      <DataTablePagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        loading={loading}
      />
    </div>
  );
}
