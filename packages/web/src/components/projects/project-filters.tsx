import { useCallback } from "react";
import { Select } from "@/components/ui/select";
import type { ProjectScope } from "@/lib/format";

export type MinSessionsValue = 0 | 5 | 10 | 20 | 50;
export type ScopeFilter = "" | ProjectScope;

interface ProjectFiltersProps {
  minSessions: MinSessionsValue;
  scope: ScopeFilter;
  onMinSessionsChange: (v: MinSessionsValue) => void;
  onScopeChange: (v: ScopeFilter) => void;
}

const MIN_SESSIONS_OPTIONS: { value: MinSessionsValue; label: string }[] = [
  { value: 0, label: "All projects" },
  { value: 5, label: "≥ 5 sessions" },
  { value: 10, label: "≥ 10 sessions" },
  { value: 20, label: "≥ 20 sessions" },
  { value: 50, label: "≥ 50 sessions" },
];

const SCOPE_OPTIONS: { value: ScopeFilter; label: string }[] = [
  { value: "", label: "All scopes" },
  { value: "personal", label: "Personal" },
  { value: "work", label: "Work" },
];

export function ProjectFilters({
  minSessions,
  scope,
  onMinSessionsChange,
  onScopeChange,
}: ProjectFiltersProps) {
  const handleMinSessionsChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onMinSessionsChange(Number(e.target.value) as MinSessionsValue);
    },
    [onMinSessionsChange],
  );

  const handleScopeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onScopeChange(e.target.value as ScopeFilter);
    },
    [onScopeChange],
  );

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="project-filters"
    >
      <Select
        value={String(minSessions)}
        onChange={handleMinSessionsChange}
        className="w-auto min-w-[140px]"
        data-testid="filter-min-sessions"
      >
        {MIN_SESSIONS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>

      <Select
        value={scope}
        onChange={handleScopeChange}
        className="w-auto min-w-[120px]"
        data-testid="filter-scope"
      >
        {SCOPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
