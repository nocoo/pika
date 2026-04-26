import type { Source } from "@pika/core";
import {
  getCoreRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import useSWR from "swr";
import { getSessionColumns } from "@/components/sessions/session-columns";
import {
  type MessageRange,
  SessionFilters,
} from "@/components/sessions/session-filters";
import { DataTable } from "@/components/ui/data-table";
import {
  type BulkAction,
  DataTableBulkBar,
  SESSION_BULK_ACTIONS,
} from "@/components/ui/data-table-bulk-bar";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { swrFetcher } from "@/lib/api";
import type {
  SessionCardData,
  SessionListResponse,
  SessionSort,
} from "@/lib/sessions-types";

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

export function messageRangeToParams(range: MessageRange): {
  minMessages?: string;
  maxMessages?: string;
} {
  switch (range) {
    case "0-10":
      return { minMessages: "0", maxMessages: "10" };
    case "11-50":
      return { minMessages: "11", maxMessages: "50" };
    case "51-200":
      return { minMessages: "51", maxMessages: "200" };
    case "201+":
      return { minMessages: "201" };
    default:
      return {};
  }
}

export function SessionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const source = (searchParams.get("source") ?? "") as Source | "";
  const sort = (searchParams.get("sort") ?? "last_message_at") as SessionSort;
  const model = searchParams.get("model") ?? "";
  const starred = searchParams.get("starred") === "true";
  const messageRange = (searchParams.get("messageRange") ?? "") as MessageRange;
  const includeDeleted = searchParams.get("includeDeleted") === "true";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10) || 50),
  );

  const updateParams = useCallback(
    (mutator: (p: URLSearchParams) => void) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          mutator(next);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setParam = useCallback(
    (key: string, value: string | null, resetPage = true) => {
      updateParams((p) => {
        if (value === null || value === "") p.delete(key);
        else p.set(key, value);
        if (resetPage) p.delete("page");
      });
    },
    [updateParams],
  );

  const [starredMap, setStarredMap] = useState<Map<string, boolean>>(new Map());
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [selectAllMode, setSelectAllMode] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (source) params.set("source", source);
    if (model) params.set("model", model);
    if (starred) params.set("starred", "true");
    if (includeDeleted) params.set("includeDeleted", "true");
    params.set("sort", sort);
    params.set("page", String(page));
    params.set("limit", String(pageSize));
    const msg = messageRangeToParams(messageRange);
    if (msg.minMessages) params.set("minMessages", msg.minMessages);
    if (msg.maxMessages) params.set("maxMessages", msg.maxMessages);
    return `/api/sessions?${params.toString()}`;
  }, [
    source,
    model,
    starred,
    includeDeleted,
    sort,
    page,
    pageSize,
    messageRange,
  ]);

  const { data, error, isLoading, mutate } = useSWR<SessionListResponse>(
    apiUrl,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: false },
  );

  const sessions: SessionCardData[] = useMemo(
    () => (data?.sessions ?? []) as SessionCardData[],
    [data],
  );
  const totalCount = data?.totalCount ?? 0;
  const loading = isLoading;

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
        if (apiSort) setParam("sort", apiSort);
      }
    },
    [sorting, setParam],
  );

  const handleToggleStar = useCallback(
    async (sessionId: string, newStarred: boolean) => {
      setStarredMap((prev) => new Map(prev).set(sessionId, newStarred));
      try {
        const res = await fetch(`/api/sessions/${sessionId}/star`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ starred: newStarred }),
        });
        if (!res.ok) {
          setStarredMap((prev) => new Map(prev).set(sessionId, !newStarred));
        }
      } catch {
        setStarredMap((prev) => new Map(prev).set(sessionId, !newStarred));
      }
    },
    [],
  );

  const columns = useMemo(
    () =>
      getSessionColumns(starredMap, handleToggleStar, {
        enableSelection: true,
      }),
    [starredMap, handleToggleStar],
  );

  const selectedCount = Object.keys(rowSelection).length;

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

  const buildBatchFilter = useCallback(() => {
    const filter: Record<string, unknown> = {};
    if (source) filter.source = source;
    if (model) filter.model = model;
    if (starred) filter.starred = true;
    if (includeDeleted) filter.includeDeleted = true;
    const msg = messageRangeToParams(messageRange);
    if (msg.minMessages) filter.minMessages = parseInt(msg.minMessages, 10);
    if (msg.maxMessages) filter.maxMessages = parseInt(msg.maxMessages, 10);
    return filter;
  }, [source, model, starred, includeDeleted, messageRange]);

  const handleBulkAction = useCallback(
    async (action: BulkAction) => {
      setBulkLoading(true);
      setBulkError(null);
      try {
        const body: Record<string, unknown> = { action };
        if (selectAllMode) body.filter = buildBatchFilter();
        else body.ids = Object.keys(rowSelection);

        const res = await fetch("/api/sessions/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res
            .json()
            .catch(() => ({ error: "Unknown error" }));
          setBulkError(
            (err as { error: string }).error ?? "Batch operation failed",
          );
          return;
        }

        setRowSelection({});
        setSelectAllMode(false);
        await mutate();
      } catch {
        setBulkError("Batch operation failed");
      } finally {
        setBulkLoading(false);
      }
    },
    [selectAllMode, rowSelection, buildBatchFilter, mutate],
  );

  const errorMessage =
    bulkError ??
    (error
      ? error instanceof Error
        ? error.message
        : "Failed to load sessions"
      : null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight font-display">
            Sessions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Browse your coding agent sessions
          </p>
        </div>
        <SessionFilters
          source={source}
          sort={sort}
          model={model}
          starred={starred}
          includeDeleted={includeDeleted}
          messageRange={messageRange}
          onSourceChange={(v) => setParam("source", v)}
          onSortChange={(v) =>
            setParam("sort", v === "last_message_at" ? null : v)
          }
          onModelChange={(v) => setParam("model", v)}
          onStarredChange={(v) => setParam("starred", v ? "true" : null)}
          onIncludeDeletedChange={(v) =>
            setParam("includeDeleted", v ? "true" : null)
          }
          onMessageRangeChange={(v) => setParam("messageRange", v)}
        />
      </div>

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
        actions={SESSION_BULK_ACTIONS}
        loading={bulkLoading}
      />

      {errorMessage && (
        <div className="text-sm text-destructive py-4" data-testid="error">
          {errorMessage}
        </div>
      )}

      <DataTable
        table={table}
        columns={columns}
        loading={loading}
        emptyMessage="No sessions found. Try adjusting your filters."
      />

      <DataTablePagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={(p) =>
          updateParams((s) => {
            if (p > 1) s.set("page", String(p));
            else s.delete("page");
          })
        }
        onPageSizeChange={(ps) =>
          updateParams((s) => {
            if (ps !== 50) s.set("pageSize", String(ps));
            else s.delete("pageSize");
            s.delete("page");
          })
        }
        loading={loading}
      />
    </div>
  );
}
