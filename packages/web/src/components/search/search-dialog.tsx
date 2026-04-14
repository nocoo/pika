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
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Focus input when dialog content mounts
  useEffect(() => {
    // Small delay to ensure dialog animation has started and element is focusable
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  // Reset selection when results change
  const resultsLength = results.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset selection when results array changes
  useEffect(() => {
    setSelectedIndex(-1);
  }, [resultsLength]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (results.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => {
            const next = prev < results.length - 1 ? prev + 1 : 0;
            // Scroll selected item into view
            const container = resultsRef.current;
            const item = container?.querySelector(
              `[data-result-index="${next}"]`,
            );
            item?.scrollIntoView({ block: "nearest" });
            return next;
          });
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => {
            const next = prev > 0 ? prev - 1 : results.length - 1;
            const container = resultsRef.current;
            const item = container?.querySelector(
              `[data-result-index="${next}"]`,
            );
            item?.scrollIntoView({ block: "nearest" });
            return next;
          });
          break;
        case "Enter":
          if (selectedIndex >= 0 && selectedIndex < results.length) {
            e.preventDefault();
            const result = results[selectedIndex];
            if (result) {
              onResultClick(result.session_id, result.ordinal);
            }
          }
          break;
      }
    },
    [results, selectedIndex, onResultClick],
  );

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
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard navigation for combobox pattern
    <div className="flex flex-col gap-4 min-h-0" onKeyDown={handleKeyDown}>
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
            aria-hidden="true"
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
            aria-label="Search sessions"
            aria-activedescendant={
              selectedIndex >= 0 ? `search-result-${selectedIndex}` : undefined
            }
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
          includeDeleted={false}
          messageRange=""
          onSourceChange={setSource}
          onSortChange={() => {}}
          onModelChange={() => {}}
          onStarredChange={() => {}}
          onIncludeDeletedChange={() => {}}
          onMessageRangeChange={() => {}}
          hideSort
        />
      </div>

      {/* Results count + keyboard hint */}
      {searched && !loading && (
        <div className="flex items-center justify-between text-xs text-muted-foreground shrink-0">
          <span>
            {total === 0
              ? "No results found"
              : `${total} result${total !== 1 ? "s" : ""}`}
          </span>
          {results.length > 0 && (
            <span className="hidden sm:inline">
              <kbd className="rounded border border-border bg-secondary px-1 py-0.5 font-mono text-micro">
                ↑↓
              </kbd>{" "}
              navigate{" "}
              <kbd className="rounded border border-border bg-secondary px-1 py-0.5 font-mono text-micro">
                ↵
              </kbd>{" "}
              select
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-sm text-destructive py-2 shrink-0">{error}</div>
      )}

      {/* Scrollable results area */}
      <div
        ref={resultsRef}
        className="flex-1 overflow-y-auto min-h-0"
        role="listbox"
        aria-label="Search results"
      >
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
              aria-hidden="true"
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
              aria-hidden="true"
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
                selected={i === selectedIndex}
                id={`search-result-${i}`}
                data-result-index={i}
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
