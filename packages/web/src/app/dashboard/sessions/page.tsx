"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  type SortingState,
} from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import {
  SessionFilters,
  type MessageRange,
} from "@/components/sessions/session-filters";
import { getSessionColumns } from "@/components/sessions/session-columns";
import type { SessionCardData } from "@/components/sessions/session-card";
import type { Source } from "@pika/core";
import type { SessionSort, SessionListResponse } from "@/lib/sessions";

// ── Sort mapping ─────────────────────────────────────────────

/** Map TanStack column IDs to API sort params */
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

// ── Message range → API params ──────────────────────────────

function messageRangeToParams(range: MessageRange): {
  minMessages?: string;
  maxMessages?: string;
} {
  switch (range) {
    case "1-10":
      return { minMessages: "1", maxMessages: "10" };
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

// ── Page component ───────────────────────────────────────────

export default function SessionsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Read initial values from URL
  const initialSource = (searchParams.get("source") ?? "") as Source | "";
  const initialSort = (searchParams.get("sort") ?? "last_message_at") as SessionSort;
  const initialModel = searchParams.get("model") ?? "";
  const initialStarred = searchParams.get("starred") === "true";
  const initialMessageRange = (searchParams.get("messageRange") ?? "") as MessageRange;
  const initialPage = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const initialPageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10) || 50));

  // State
  const [source, setSource] = useState<Source | "">(initialSource);
  const [sort, setSort] = useState<SessionSort>(initialSort);
  const [model, setModel] = useState(initialModel);
  const [starred, setStarred] = useState(initialStarred);
  const [messageRange, setMessageRange] = useState<MessageRange>(initialMessageRange);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [sessions, setSessions] = useState<SessionCardData[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Star state (optimistic)
  const [starredMap, setStarredMap] = useState<Map<string, boolean>>(new Map());

  // Sorting state for TanStack
  const sorting: SortingState = useMemo(() => {
    const columnId = SORT_TO_COLUMN[sort];
    return columnId ? [{ id: columnId, desc: true }] : [];
  }, [sort]);

  // Handle sorting change from table header clicks
  const onSortingChange = useCallback(
    (updaterOrValue: SortingState | ((old: SortingState) => SortingState)) => {
      const newSorting =
        typeof updaterOrValue === "function"
          ? updaterOrValue(sorting)
          : updaterOrValue;

      if (newSorting.length > 0) {
        const apiSort = COLUMN_TO_SORT[newSorting[0]!.id];
        if (apiSort) {
          setSort(apiSort);
          setPage(1);
        }
      }
    },
    [sorting],
  );

  // Star toggle
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

  // Column definitions
  const columns = useMemo(
    () => getSessionColumns(starredMap, handleToggleStar),
    [starredMap, handleToggleStar],
  );

  // TanStack table instance
  const table = useReactTable({
    data: sessions,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    state: { sorting },
    onSortingChange,
    enableSortingRemoval: false,
  });

  // Build API URL from state
  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (source) params.set("source", source);
    if (model) params.set("model", model);
    if (starred) params.set("starred", "true");
    params.set("sort", sort);
    params.set("page", String(page));
    params.set("limit", String(pageSize));

    const msgParams = messageRangeToParams(messageRange);
    if (msgParams.minMessages) params.set("minMessages", msgParams.minMessages);
    if (msgParams.maxMessages) params.set("maxMessages", msgParams.maxMessages);

    return `/api/sessions?${params.toString()}`;
  }, [source, model, starred, sort, page, pageSize, messageRange]);

  // Fetch sessions
  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SessionListResponse = await res.json();
      setSessions(data.sessions as unknown as SessionCardData[]);
      setTotalCount(data.totalCount ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  // Re-fetch when dependencies change
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Sync state to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (source) params.set("source", source);
    if (model) params.set("model", model);
    if (starred) params.set("starred", "true");
    if (sort !== "last_message_at") params.set("sort", sort);
    if (messageRange) params.set("messageRange", messageRange);
    if (page > 1) params.set("page", String(page));
    if (pageSize !== 50) params.set("pageSize", String(pageSize));
    const query = params.toString();
    router.replace(`/dashboard/sessions${query ? `?${query}` : ""}`, {
      scroll: false,
    });
  }, [source, model, starred, sort, messageRange, page, pageSize, router]);

  // Reset to page 1 when filters change
  const handleSourceChange = useCallback((s: Source | "") => {
    setSource(s);
    setPage(1);
  }, []);

  const handleModelChange = useCallback((m: string) => {
    setModel(m);
    setPage(1);
  }, []);

  const handleStarredChange = useCallback((s: boolean) => {
    setStarred(s);
    setPage(1);
  }, []);

  const handleSortChange = useCallback((s: SessionSort) => {
    setSort(s);
    setPage(1);
  }, []);

  const handleMessageRangeChange = useCallback((r: MessageRange) => {
    setMessageRange(r);
    setPage(1);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
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
          messageRange={messageRange}
          onSourceChange={handleSourceChange}
          onSortChange={handleSortChange}
          onModelChange={handleModelChange}
          onStarredChange={handleStarredChange}
          onMessageRangeChange={handleMessageRangeChange}
        />
      </div>

      {/* Error state */}
      {error && (
        <div className="text-sm text-destructive py-4">{error}</div>
      )}

      {/* Data table */}
      <DataTable
        table={table}
        columns={columns}
        loading={loading}
        emptyMessage="No sessions found. Try adjusting your filters."
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
