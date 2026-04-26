import type { Source } from "@pika/core";
import useSWR from "swr";
import { Select } from "@/components/ui/select";
import { swrFetcher } from "@/lib/api";
import type { SessionSort } from "@/lib/sessions-types";

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
  includeDeleted: boolean;
  messageRange: MessageRange;
  onSourceChange: (source: Source | "") => void;
  onSortChange: (sort: SessionSort) => void;
  onModelChange: (model: string) => void;
  onStarredChange: (starred: boolean) => void;
  onIncludeDeletedChange: (includeDeleted: boolean) => void;
  onMessageRangeChange: (range: MessageRange) => void;
  hideSort?: boolean;
}

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

export function SessionFilters({
  source,
  sort,
  model,
  starred,
  includeDeleted,
  messageRange,
  onSourceChange,
  onSortChange,
  onModelChange,
  onStarredChange,
  onIncludeDeletedChange,
  onMessageRangeChange,
  hideSort,
}: SessionFiltersProps) {
  const { data: filterOptions } = useSWR<FilterOptions>(
    "/api/sessions/filters",
    swrFetcher,
    { revalidateOnFocus: false },
  );
  const models = filterOptions?.models ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={source}
        onChange={(e) => onSourceChange(e.target.value as Source | "")}
        className="w-auto min-w-[130px]"
        data-testid="filter-source"
      >
        {AGENT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>

      {models.length > 0 && (
        <Select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="w-auto min-w-[130px]"
          data-testid="filter-model"
        >
          <option value="">All models</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      )}

      <Select
        value={messageRange}
        onChange={(e) => onMessageRangeChange(e.target.value as MessageRange)}
        className="w-auto min-w-[120px]"
        data-testid="filter-message-range"
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
          onChange={(e) => onSortChange(e.target.value as SessionSort)}
          className="w-auto min-w-[130px]"
          data-testid="filter-sort"
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
          onChange={(e) => onStarredChange(e.target.checked)}
          className="rounded border-border"
          data-testid="filter-starred"
        />
        Starred
      </label>

      <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
        <input
          type="checkbox"
          checked={includeDeleted}
          onChange={(e) => onIncludeDeletedChange(e.target.checked)}
          className="rounded border-border"
          data-testid="filter-include-deleted"
        />
        Include deleted
      </label>
    </div>
  );
}
