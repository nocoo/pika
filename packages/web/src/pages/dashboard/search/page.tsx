import type { Source } from "@pika/core";
import { Search as SearchIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  SearchResultCard,
  type SearchResultData,
} from "@/components/search/search-result-card";
import { SessionFilters } from "@/components/sessions/session-filters";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const initialQ = searchParams.get("q") ?? "";
  const initialSource = (searchParams.get("source") ?? "") as Source | "";
  const initialIncludeDeleted = searchParams.get("includeDeleted") === "true";

  const [query, setQuery] = useState(initialQ);
  const [source, setSource] = useState<Source | "">(initialSource);
  const [includeDeleted, setIncludeDeleted] = useState(initialIncludeDeleted);
  const [results, setResults] = useState<SearchResultData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const executeSearch = useCallback(
    async (q: string, src: Source | "", inclDeleted: boolean) => {
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
        if (inclDeleted) params.set("includeDeleted", "true");
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
    },
    [],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      executeSearch(query, source, includeDeleted);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, source, includeDeleted, executeSearch]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (source) params.set("source", source);
    if (includeDeleted) params.set("includeDeleted", "true");
    setSearchParams(params, { replace: true });
  }, [query, source, includeDeleted, setSearchParams]);

  const handleResultClick = useCallback(
    (result: SearchResultData) => {
      navigate(
        `/dashboard/sessions/${result.session_id}#msg-${result.ordinal}`,
      );
    },
    [navigate],
  );

  return (
    <div className="flex flex-col gap-6" data-testid="search-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight font-display">
          Search
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Full-text search across all your coding sessions
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
            aria-hidden="true"
            strokeWidth={1.5}
          />
          <Input
            ref={inputRef}
            type="search"
            placeholder="Search messages, tool calls, code..."
            aria-label="Search sessions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10"
            data-testid="search-input"
          />
        </div>
        <SessionFilters
          source={source}
          sort="last_message_at"
          model=""
          starred={false}
          includeDeleted={includeDeleted}
          messageRange=""
          onSourceChange={setSource}
          onSortChange={() => {}}
          onModelChange={() => {}}
          onStarredChange={() => {}}
          onIncludeDeletedChange={setIncludeDeleted}
          onMessageRangeChange={() => {}}
          hideSort
        />
      </div>

      {searched && !loading && (
        <div
          className="text-xs text-muted-foreground"
          aria-live="polite"
          data-testid="search-status"
        >
          {total === 0
            ? "No results found"
            : `${total} result${total !== 1 ? "s" : ""}`}
        </div>
      )}

      {error && (
        <div
          className="text-sm text-destructive py-2"
          aria-live="polite"
          data-testid="search-error"
        >
          {error}
        </div>
      )}

      {loading && (
        <div
          className="flex flex-col gap-3"
          aria-live="polite"
          data-testid="search-loading"
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      )}

      {!loading && searched && results.length === 0 && !error && (
        <div
          className="flex flex-col items-center justify-center py-20 text-sm text-muted-foreground"
          data-testid="search-empty"
        >
          No results matching &ldquo;{query}&rdquo;
        </div>
      )}

      {!loading && !searched && (
        <div
          className="flex flex-col items-center justify-center py-20 text-sm text-muted-foreground"
          data-testid="search-initial"
        >
          Start typing to search your sessions
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="flex flex-col gap-3" data-testid="search-results">
          {results.map((result, i) => (
            <SearchResultCard
              key={`${result.session_id}-${result.message_id}-${result.chunk_index}-${i}`}
              result={result}
              onClick={() => handleResultClick(result)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
