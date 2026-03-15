"use client";

import { useCallback, useEffect, useState } from "react";
import { Select } from "@/components/ui/select";
import type { Source } from "@pika/core";
import type { SessionSort } from "@/lib/sessions";

// ── Types ──────────────────────────────────────────────────────

interface FilterOptions {
  models: string[];
  projects: { ref: string; name: string | null }[];
}

interface SessionFiltersProps {
  source: Source | "";
  sort: SessionSort;
  model: string;
  starred: boolean;
  onSourceChange: (source: Source | "") => void;
  onSortChange: (sort: SessionSort) => void;
  onModelChange: (model: string) => void;
  onStarredChange: (starred: boolean) => void;
  /** Hide the sort dropdown (e.g. on search page where sort is by relevance). */
  hideSort?: boolean;
}

// ── Source options ──────────────────────────────────────────────

const SOURCE_OPTIONS: { value: Source | ""; label: string }[] = [
  { value: "", label: "All sources" },
  { value: "claude-code", label: "Claude Code" },
  { value: "codex", label: "Codex CLI" },
  { value: "gemini-cli", label: "Gemini CLI" },
  { value: "opencode", label: "OpenCode" },
  { value: "vscode-copilot", label: "VS Code Copilot" },
];

const SORT_OPTIONS: { value: SessionSort; label: string }[] = [
  { value: "last_message_at", label: "Last active" },
  { value: "started_at", label: "Started" },
  { value: "total_input_tokens", label: "Token usage" },
  { value: "total_messages", label: "Messages" },
  { value: "duration_seconds", label: "Duration" },
];

// ── SessionFilters ─────────────────────────────────────────────

export function SessionFilters({
  source,
  sort,
  model,
  starred,
  onSourceChange,
  onSortChange,
  onModelChange,
  onStarredChange,
  hideSort,
}: SessionFiltersProps) {
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    models: [],
    projects: [],
  });

  // Fetch filter options
  useEffect(() => {
    fetch("/api/sessions/filters")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setFilterOptions(data))
      .catch(() => {
        // Silently fail — filters will be empty
      });
  }, []);

  const handleSourceChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onSourceChange(e.target.value as Source | "");
    },
    [onSourceChange],
  );

  const handleSortChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onSortChange(e.target.value as SessionSort);
    },
    [onSortChange],
  );

  const handleModelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onModelChange(e.target.value);
    },
    [onModelChange],
  );

  const handleStarredChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onStarredChange(e.target.checked);
    },
    [onStarredChange],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={source}
        onChange={handleSourceChange}
        className="w-auto min-w-[140px]"
      >
        {SOURCE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>

      {filterOptions.models.length > 0 && (
        <Select
          value={model}
          onChange={handleModelChange}
          className="w-auto min-w-[130px]"
        >
          <option value="">All models</option>
          {filterOptions.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      )}

      {!hideSort && (
        <Select
          value={sort}
          onChange={handleSortChange}
          className="w-auto min-w-[130px]"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      )}

      <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
        <input
          type="checkbox"
          checked={starred}
          onChange={handleStarredChange}
          className="rounded border-border"
        />
        Starred
      </label>
    </div>
  );
}
