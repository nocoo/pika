"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SearchResultCard,
  type SearchResultData,
} from "@/components/search/search-result-card";
import { SessionFilters } from "@/components/sessions/session-filters";
import type { Source } from "@pika/core";

export default function SearchPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialQ = searchParams.get("q") ?? "";
  const initialSource = (searchParams.get("source") ?? "") as Source | "";

  const [query, setQuery] = useState(initialQ);
  const [source, setSource] = useState<Source | "">(initialSource);
  const [results, setResults] = useState<SearchResultData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ── Search execution ────────────────────────────────────────

  const executeSearch = useCallback(
    async (q: string, src: Source | "") => {
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
        setError(
          err instanceof Error ? err.message : "Search failed",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

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

  // Sync to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (source) params.set("source", source);
    const qs = params.toString();
    router.replace(`/dashboard/search${qs ? `?${qs}` : ""}`, {
      scroll: false,
    });
  }, [query, source, router]);

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight font-display">
          Search
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Full-text search across all your coding sessions
        </p>
      </div>

      {/* Search input + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
          onSourceChange={setSource}
          onSortChange={() => {}}
          hideSort
        />
      </div>

      {/* Results count */}
      {searched && !loading && (
        <div className="text-xs text-muted-foreground">
          {total === 0
            ? "No results found"
            : `${total} result${total !== 1 ? "s" : ""}`}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-sm text-destructive py-2">{error}</div>
      )}

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
            />
          ))}
        </div>
      )}
    </div>
  );
}
