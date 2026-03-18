"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  type SortingState,
} from "@tanstack/react-table";
import {
  FolderKanban,
  MessageSquare,
  Layers,
  Coins,
  X,
} from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { StatGrid, StatCard } from "@/components/dashboard/stat-card";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectRankingChart } from "@/components/projects/project-ranking-chart";
import { ProjectActivityChart } from "@/components/projects/project-activity-chart";
import { getSessionColumns } from "@/components/sessions/session-columns";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTokens } from "@/lib/utils";
import { projectDisplayName } from "@/lib/format";
import type { SessionCardData } from "@/components/sessions/session-card";
import type { SessionSort, SessionListResponse } from "@/lib/sessions";
import type {
  ProjectItem,
  ProjectOverview,
  ProjectSourceCount,
} from "@/lib/projects";

// ── Sort mapping ─────────────────────────────────────────────

const COLUMN_TO_SORT: Record<string, SessionSort> = {
  total_messages: "total_messages",
  total_input_tokens: "total_input_tokens",
  duration_seconds: "duration_seconds",
  last_message_at: "last_message_at",
  started_at: "started_at",
};

const SORT_TO_COLUMN: Record<SessionSort, string> = {
  total_messages: "total_messages",
  total_input_tokens: "total_input_tokens",
  duration_seconds: "duration_seconds",
  last_message_at: "last_message_at",
  started_at: "started_at",
};

// ── Page component ───────────────────────────────────────────

export default function ProjectsPage() {
  // Project list state
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [sourceDistribution, setSourceDistribution] = useState<
    Record<string, ProjectSourceCount[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedRef, setSelectedRef] = useState<string | null>(null);

  // Session drill-down state
  const [sessions, setSessions] = useState<SessionCardData[]>([]);
  const [sessionsTotalCount, setSessionsTotalCount] = useState(0);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsPage, setSessionsPage] = useState(1);
  const [sessionsPageSize, setSessionsPageSize] = useState(25);
  const [sessionsSort, setSessionsSort] = useState<SessionSort>("last_message_at");

  // Star state (optimistic)
  const [starredMap, setStarredMap] = useState<Map<string, boolean>>(new Map());

  // Ref for scrolling to drill-down section
  const drillDownRef = useRef<HTMLDivElement>(null);

  // ── Fetch projects ─────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function fetchProjects() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/projects");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setOverview(data.overview);
          setProjects(data.projects);
          setSourceDistribution(data.sourceDistribution);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load projects");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Handle project card click ──────────────────────────────

  const handleProjectClick = useCallback(
    (ref: string) => {
      if (selectedRef === ref) {
        setSelectedRef(null);
        setSessions([]);
        setSessionsTotalCount(0);
      } else {
        setSelectedRef(ref);
        setSessionsPage(1);
        setSessionsSort("last_message_at");
        // Scroll to drill-down after a tick
        setTimeout(() => {
          drillDownRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
      }
    },
    [selectedRef],
  );

  // ── Fetch sessions for selected project ────────────────────

  const buildSessionsUrl = useCallback(() => {
    if (!selectedRef) return null;
    const params = new URLSearchParams();
    params.set("project", selectedRef);
    params.set("sort", sessionsSort);
    params.set("page", String(sessionsPage));
    params.set("limit", String(sessionsPageSize));
    return `/api/sessions?${params.toString()}`;
  }, [selectedRef, sessionsSort, sessionsPage, sessionsPageSize]);

  const fetchSessions = useCallback(async () => {
    const url = buildSessionsUrl();
    if (!url) return;

    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SessionListResponse = await res.json();
      setSessions(data.sessions as unknown as SessionCardData[]);
      setSessionsTotalCount(data.totalCount ?? 0);
    } catch (err) {
      setSessionsError(
        err instanceof Error ? err.message : "Failed to load sessions",
      );
    } finally {
      setSessionsLoading(false);
    }
  }, [buildSessionsUrl]);

  useEffect(() => {
    if (selectedRef) {
      fetchSessions();
    }
  }, [selectedRef, fetchSessions]);

  // ── Star toggle ────────────────────────────────────────────

  const handleToggleStar = useCallback(
    async (sessionId: string, newStarred: boolean) => {
      setStarredMap((prev) => new Map(prev).set(sessionId, newStarred));

      try {
        const res = await fetch(`/api/sessions/${sessionId}/star`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ starred: newStarred }),
        });
        if (!res.ok) {
          setStarredMap((prev) => new Map(prev).set(sessionId, !newStarred));
        }
      } catch {
        setStarredMap((prev) => new Map(prev).set(sessionId, !newStarred));
      }
    },
    [],
  );

  // ── Sessions table setup ───────────────────────────────────

  const columns = useMemo(
    () => getSessionColumns(starredMap, handleToggleStar),
    [starredMap, handleToggleStar],
  );

  const sorting: SortingState = useMemo(() => {
    const columnId = SORT_TO_COLUMN[sessionsSort];
    return columnId ? [{ id: columnId, desc: true }] : [];
  }, [sessionsSort]);

  const onSortingChange = useCallback(
    (updaterOrValue: SortingState | ((old: SortingState) => SortingState)) => {
      const newSorting =
        typeof updaterOrValue === "function"
          ? updaterOrValue(sorting)
          : updaterOrValue;

      if (newSorting.length > 0) {
        const apiSort = COLUMN_TO_SORT[newSorting[0]!.id];
        if (apiSort) {
          setSessionsSort(apiSort);
          setSessionsPage(1);
        }
      }
    },
    [sorting],
  );

  const table = useReactTable({
    data: sessions,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    state: { sorting },
    onSortingChange,
    enableSortingRemoval: false,
    getRowId: (row) => row.id,
  });

  // ── Selected project name for header ───────────────────────

  const selectedProject = projects.find((p) => p.project_ref === selectedRef);

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight font-display">
          Projects
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Explore your coding projects and their session activity
        </p>
      </div>

      {/* Error state */}
      {error && (
        <div className="text-sm text-destructive py-4">{error}</div>
      )}

      {/* Stat cards */}
      {loading ? (
        <StatGrid>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[88px] rounded-xl" />
          ))}
        </StatGrid>
      ) : overview ? (
        <StatGrid>
          <StatCard
            label="Total Projects"
            value={overview.totalProjects.toLocaleString()}
            icon={<FolderKanban className="h-4 w-4" />}
          />
          <StatCard
            label="Total Sessions"
            value={overview.totalSessions.toLocaleString()}
            icon={<Layers className="h-4 w-4" />}
          />
          <StatCard
            label="Total Tokens"
            value={formatTokens(
              overview.totalInputTokens + overview.totalOutputTokens,
            )}
            icon={<Coins className="h-4 w-4" />}
          />
          <StatCard
            label="Total Messages"
            value={overview.totalMessages.toLocaleString()}
            icon={<MessageSquare className="h-4 w-4" />}
          />
        </StatGrid>
      ) : null}

      {/* Ranking chart */}
      {loading ? (
        <Skeleton className="h-[380px] rounded-xl" />
      ) : (
        <ProjectRankingChart projects={projects} />
      )}

      {/* Project cards grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[96px] rounded-xl" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-12">
          No projects found. Sessions will appear here once they have a project reference.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.project_ref}
              project={project}
              sources={sourceDistribution[project.project_ref] ?? []}
              selected={selectedRef === project.project_ref}
              onClick={() => handleProjectClick(project.project_ref)}
            />
          ))}
        </div>
      )}

      {/* Drill-down section */}
      {selectedRef && (
        <div ref={drillDownRef} className="flex flex-col gap-4">
          {/* Section header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              {projectDisplayName(selectedProject?.project_name ?? null, selectedRef ?? undefined)}
            </h2>
            <button
              type="button"
              onClick={() => {
                setSelectedRef(null);
                setSessions([]);
                setSessionsTotalCount(0);
              }}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
              Close
            </button>
          </div>

          {/* Activity chart */}
          <ProjectActivityChart projectRef={selectedRef} />

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
            onPageChange={setSessionsPage}
            onPageSizeChange={setSessionsPageSize}
            loading={sessionsLoading}
          />
        </div>
      )}
    </div>
  );
}
