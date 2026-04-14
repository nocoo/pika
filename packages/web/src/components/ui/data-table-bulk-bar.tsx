"use client";

import { Loader2, RotateCcw, Star, StarOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Types ──────────────────────────────────────────────────────

export type BulkAction = "delete" | "restore" | "star" | "unstar";

interface BulkActionDef {
  action: BulkAction;
  label: string;
  icon: React.ReactNode;
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
}

interface DataTableBulkBarProps {
  selectedCount: number;
  totalCount: number;
  /** When true, user chose "select all matching" (filter mode) */
  selectAllMode: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onAction: (action: BulkAction) => void;
  actions: BulkActionDef[];
  loading?: boolean;
}

// ── Preset action definitions ─────────────────────────────────

export const SESSION_BULK_ACTIONS: BulkActionDef[] = [
  { action: "star", label: "Star", icon: <Star className="h-3.5 w-3.5" /> },
  {
    action: "unstar",
    label: "Unstar",
    icon: <StarOff className="h-3.5 w-3.5" />,
  },
  {
    action: "delete",
    label: "Delete",
    icon: <Trash2 className="h-3.5 w-3.5" />,
    variant: "destructive",
  },
];

export const TRASH_BULK_ACTIONS: BulkActionDef[] = [
  {
    action: "restore",
    label: "Restore",
    icon: <RotateCcw className="h-3.5 w-3.5" />,
  },
];

// ── Component ─────────────────────────────────────────────────

export function DataTableBulkBar({
  selectedCount,
  totalCount,
  selectAllMode,
  onSelectAll,
  onClearSelection,
  onAction,
  actions,
  loading = false,
}: DataTableBulkBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-card)] bg-card px-4 py-2.5">
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        {selectAllMode ? (
          <>
            All <strong>{totalCount}</strong> matching selected
          </>
        ) : (
          <>
            <strong>{selectedCount}</strong> selected
          </>
        )}
      </span>

      {/* "Select all N matching" link — only when rows are manually selected */}
      {!selectAllMode && selectedCount > 0 && totalCount > selectedCount && (
        <button
          type="button"
          onClick={onSelectAll}
          className="text-sm text-primary hover:underline whitespace-nowrap"
        >
          Select all {totalCount} matching
        </button>
      )}

      <div className="h-4 w-px bg-border" />

      {/* Action buttons */}
      {actions.map((def) => (
        <Button
          key={def.action}
          size="sm"
          variant={def.variant ?? "outline"}
          onClick={() => onAction(def.action)}
          disabled={loading}
          className="gap-1.5 h-7 text-xs"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            def.icon
          )}
          {def.label}
        </Button>
      ))}

      <button
        type="button"
        onClick={onClearSelection}
        className="ml-auto text-xs text-muted-foreground hover:text-foreground"
      >
        Clear
      </button>
    </div>
  );
}
