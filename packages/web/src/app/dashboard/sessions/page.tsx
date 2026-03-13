"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { SessionCard, type SessionCardData } from "@/components/sessions/session-card";
import { SessionFilters } from "@/components/sessions/session-filters";
import type { Source } from "@pika/core";
import type { SessionSort } from "@/lib/sessions";

export default function SessionsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Read initial filter values from URL
  const initialSource = (searchParams.get("source") ?? "") as Source | "";
  const initialSort = (searchParams.get("sort") ?? "last_message_at") as SessionSort;

  const [source, setSource] = useState<Source | "">(initialSource);
  const [sort, setSort] = useState<SessionSort>(initialSort);
  const [sessions, setSessions] = useState<SessionCardData[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build API URL from filters
  const buildUrl = useCallback(
    (cursorParam?: string) => {
      const params = new URLSearchParams();
      if (source) params.set("source", source);
      params.set("sort", sort);
      params.set("limit", "20");
      if (cursorParam) params.set("cursor", cursorParam);
      return `/api/sessions?${params.toString()}`;
    },
    [source, sort],
  );

  // Fetch sessions (reset)
  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessions(data.sessions);
      setCursor(data.cursor);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  // Fetch more (append)
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(buildUrl(cursor));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessions((prev) => [...prev, ...data.sessions]);
      setCursor(data.cursor);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, buildUrl]);

  // Re-fetch when filters change
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Sync filters to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (source) params.set("source", source);
    if (sort !== "last_message_at") params.set("sort", sort);
    const query = params.toString();
    router.replace(`/dashboard/sessions${query ? `?${query}` : ""}`, { scroll: false });
  }, [source, sort, router]);

  return (
    <div className="flex flex-col gap-6">
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
          onSourceChange={setSource}
          onSortChange={setSort}
        />
      </div>

      {/* Error state */}
      {error && (
        <div className="text-sm text-destructive py-4">{error}</div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      )}

      {/* Session list */}
      {!loading && sessions.length === 0 && (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          No sessions found. Try adjusting your filters.
        </div>
      )}

      {!loading && sessions.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>

          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
