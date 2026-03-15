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

export type MessageRange = "" | "0-10" | "11-50" | "51-200" | "201+";

interface SessionFiltersProps {
  source: Source | "";
  sort: SessionSort;
  model: string;
  starred: boolean;
  messageRange: MessageRange;
  onSourceChange: (source: Source | "") => void;
  onSortChange: (sort: SessionSort) => void;
  onModelChange: (model: string) => void;
  onStarredChange: (starred: boolean) => void;
  onMessageRangeChange: (range: MessageRange) => void;
  /** Hide the sort dropdown (e.g. on search page where sort is by relevance). */
  hideSort?: boolean;
}

// ── Agent options (was "Source") ─────────────────────────────────

const AGENT_OPTIONS: { value: Source | ""; label: string }[] = [
  { value: "", label: "All agents" },
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

const MESSAGE_RANGE_OPTIONS: { value: MessageRange; label: string }[] = [
  { value: "", label: "All sizes" },
  { value: "0-10", label: "0–10 msgs" },
  { value: "11-50", label: "11–50 msgs" },
  { value: "51-200", label: "51–200 msgs" },
  { value: "201+", label: "201+ msgs" },
];

// ── SessionFilters ─────────────────────────────────────────────

export function SessionFilters({
  source,
  sort,
  model,
  starred,
  messageRange,
  onSourceChange,
  onSortChange,
  onModelChange,
  onStarredChange,
  onMessageRangeChange,
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

  const handleMessageRangeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onMessageRangeChange(e.target.value as MessageRange);
    },
    [onMessageRangeChange],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={source}
        onChange={handleSourceChange}
        className="w-auto min-w-[130px]"
      >
        {AGENT_OPTIONS.map((opt) => (
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

      <Select
        value={messageRange}
        onChange={handleMessageRangeChange}
        className="w-auto min-w-[120px]"
      >
        {MESSAGE_RANGE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>

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
