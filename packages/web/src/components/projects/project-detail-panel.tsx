"use client";

import type { ColumnDef, Table } from "@tanstack/react-table";
import { FolderKanban, X } from "lucide-react";
import { ProjectActivityChart } from "@/components/projects/project-activity-chart";
import type { SessionCardData } from "@/components/sessions/session-card";
import { DataTable } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { projectDisplayName } from "@/lib/format";
import type { ProjectItem } from "@/lib/projects";

// ── Types ──────────────────────────────────────────────────────

interface ProjectDetailPanelProps {
  selectedKey: string | null;
  /** Comma-separated project keys for merged worktree projects */
  activityKeys: string | null;
  selectedProject: ProjectItem | undefined;
  sessionsError: string | null;
  sessionsLoading: boolean;
  table: Table<SessionCardData>;
  columns: ColumnDef<SessionCardData, unknown>[];
  sessionsPage: number;
  sessionsPageSize: number;
  sessionsTotalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onClose: () => void;
}

// ── Component ──────────────────────────────────────────────────

export function ProjectDetailPanel({
  selectedKey,
  activityKeys,
  selectedProject,
  sessionsError,
  sessionsLoading,
  table,
  columns,
  sessionsPage,
  sessionsPageSize,
  sessionsTotalCount,
  onPageChange,
  onPageSizeChange,
  onClose,
}: ProjectDetailPanelProps) {
  if (!selectedKey) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground py-24">
        <FolderKanban className="h-12 w-12 opacity-30" />
        <p className="text-sm">Select a project to view details</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">
          {projectDisplayName(
            selectedProject?.project_name ?? null,
            selectedKey ?? undefined,
          )}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
          Close
        </button>
      </div>

      {/* Activity chart */}
      <ProjectActivityChart projectKey={activityKeys ?? selectedKey} />

      {/* Sessions error */}
      {sessionsError && (
        <div className="text-sm text-destructive">{sessionsError}</div>
      )}

      {/* Sessions table */}
      <DataTable
        table={table}
        columns={columns}
        loading={sessionsLoading}
        emptyMessage="No sessions found for this project."
        skeletonRows={5}
      />

      {/* Pagination */}
      <DataTablePagination
        page={sessionsPage}
        pageSize={sessionsPageSize}
        totalCount={sessionsTotalCount}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        loading={sessionsLoading}
      />
    </div>
  );
}
