"use client";

import { useCallback } from "react";
import { Select } from "@/components/ui/select";
import type { Source } from "@pika/core";
import type { SessionSort } from "@/lib/sessions";

// ── Types ──────────────────────────────────────────────────────

interface SessionFiltersProps {
  source: Source | "";
  sort: SessionSort;
  onSourceChange: (source: Source | "") => void;
  onSortChange: (sort: SessionSort) => void;
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
  { value: "duration_seconds", label: "Duration" },
];

// ── SessionFilters ─────────────────────────────────────────────

export function SessionFilters({
  source,
  sort,
  onSourceChange,
  onSortChange,
}: SessionFiltersProps) {
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
    </div>
  );
}
