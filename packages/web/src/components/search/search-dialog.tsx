"use client";

import type { Source } from "@pika/core";
import { useRouter } from "next/navigation";
import { VisuallyHidden } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  SearchResultCard,
  type SearchResultData,
} from "@/components/search/search-result-card";
import { SessionFilters } from "@/components/sessions/session-filters";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

// ── SearchDialogContent ────────────────────────────────────────
// The search UI extracted from the search page, without header or URL sync.

function SearchDialogContent({
  onResultClick,
}: {
  onResultClick: (sessionId: string, ordinal: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<Source | "">("");
  const [results, setResults] = useState<SearchResultData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Focus input when dialog content mounts
  useEffect(() => {
    // Small delay to ensure dialog animation has started and element is focusable
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  // ── Search execution ────────────────────────────────────────

  const executeSearch = useCallback(async (q: string, src: Source | "") => {
    if (!q.trim()) {
      setResults([]);
      setTotal(0);
      setSearched(false);
      return;
    }

    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const params = new URLSearchParams();
      params.set("q", q.trim());
      if (src) params.set("source", src);
      params.set("limit", "50");

      const res = await fetch(`/api/search?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResults(data.results);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      executeSearch(query, source);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, source, executeSearch]);

  return (
    <div className="flex flex-col gap-4 min-h-0">
      {/* Search input + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center shrink-0">
        <div className="relative flex-1">
          {/* Search icon */}
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <Input
            ref={inputRef}
            type="search"
            placeholder="Search messages, tool calls, code..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <SessionFilters
          source={source}
          sort="last_message_at"
          model=""
          starred={false}
          messageRange=""
          onSourceChange={setSource}
          onSortChange={() => {}}
          onModelChange={() => {}}
          onStarredChange={() => {}}
          onMessageRangeChange={() => {}}
          hideSort
        />
      </div>

      {/* Results count */}
      {searched && !loading && (
        <div className="text-xs text-muted-foreground shrink-0">
          {total === 0
            ? "No results found"
            : `${total} result${total !== 1 ? "s" : ""}`}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-sm text-destructive py-2 shrink-0">{error}</div>
      )}

      {/* Scrollable results area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Loading skeleton */}
        {loading && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && searched && results.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-20 text-sm text-muted-foreground">
            <svg
              className="size-12 mb-3 text-muted-foreground/30"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
            No results matching &ldquo;{query}&rdquo;
          </div>
        )}

        {/* Initial state (no search yet) */}
        {!loading && !searched && (
          <div className="flex flex-col items-center justify-center py-20 text-sm text-muted-foreground">
            <svg
              className="size-12 mb-3 text-muted-foreground/30"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
            Start typing to search your sessions
          </div>
        )}

        {/* Results list */}
        {!loading && results.length > 0 && (
          <div className="flex flex-col gap-3">
            {results.map((result, i) => (
              <SearchResultCard
                key={`${result.session_id}-${result.message_id}-${result.chunk_index}-${i}`}
                result={result}
                onClick={() => onResultClick(result.session_id, result.ordinal)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── SearchDialog ───────────────────────────────────────────────

export function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  const handleResultClick = useCallback(
    (sessionId: string, ordinal: number) => {
      onOpenChange(false);
      router.push(`/dashboard/sessions/${sessionId}#msg-${ordinal}`);
    },
    [onOpenChange, router],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[80vw] max-h-[85vh] w-full flex flex-col">
        <VisuallyHidden.Root>
          <DialogTitle>Search sessions</DialogTitle>
        </VisuallyHidden.Root>
        <SearchDialogContent onResultClick={handleResultClick} />
      </DialogContent>
    </Dialog>
  );
}
