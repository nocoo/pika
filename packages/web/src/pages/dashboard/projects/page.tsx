import { type SortingState, useTable } from "@tanstack/react-table";
import {
  ChevronRight,
  Coins,
  FolderKanban,
  Layers,
  MessageSquare,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { ProjectDetailPanel } from "@/components/projects/project-detail-panel";
import {
  type MinSessionsValue,
  ProjectFilters,
  type ScopeFilter,
} from "@/components/projects/project-filters";
import { ProjectRankingChart } from "@/components/projects/project-ranking-chart";
import { ProjectSidebar } from "@/components/projects/project-sidebar";
import { getSessionColumns } from "@/components/sessions/session-columns";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { dataTableFeatures } from "@/components/ui/data-table-features";
import { Skeleton } from "@/components/ui/skeleton";
import { parseProjectDisplay } from "@/lib/format";
import type {
  ProjectItem,
  ProjectOverview,
  ProjectSourceCount,
} from "@/lib/projects-types";
import type {
  SessionCardData,
  SessionListResponse,
  SessionSort,
} from "@/lib/sessions-types";
import { cn, formatTokens } from "@/lib/utils";

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

export function ProjectsPage() {
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [sourceDistribution, setSourceDistribution] = useState<
    Record<string, ProjectSourceCount[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [minSessions, setMinSessions] = useState<MinSessionsValue>(10);
  const [scope, setScope] = useState<ScopeFilter>("");

  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionCardData[]>([]);
  const [sessionsTotalCount, setSessionsTotalCount] = useState(0);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsPage, setSessionsPage] = useState(1);
  const [sessionsPageSize, setSessionsPageSize] = useState(25);
  const [sessionsSort, setSessionsSort] =
    useState<SessionSort>("last_message_at");

  const [starredMap, setStarredMap] = useState<Map<string, boolean>>(new Map());

  const [overviewOpen, setOverviewOpen] = useState(true);

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
          setError(
            err instanceof Error ? err.message : "Failed to load projects",
          );
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

  const handleProjectClick = useCallback(
    (key: string) => {
      if (selectedKey === key) {
        setSelectedKey(null);
        setSessions([]);
        setSessionsTotalCount(0);
      } else {
        setSelectedKey(key);
        setSessionsPage(1);
        setSessionsSort("last_message_at");
      }
    },
    [selectedKey],
  );

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

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (p.session_count < minSessions) return false;
      if (scope) {
        const parsed = parseProjectDisplay(p.project_name);
        if (parsed.scope !== scope) return false;
      }
      return true;
    });
  }, [projects, minSessions, scope]);

  const { mergedProjects, projectKeyMap } = useMemo(() => {
    const groups = new Map<string, ProjectItem[]>();

    for (const p of filteredProjects) {
      const { displayName, scope: pScope } = parseProjectDisplay(
        p.project_name,
      );
      const mergeKey = `${displayName}\0${pScope ?? ""}`;
      const existing = groups.get(mergeKey);
      if (existing) {
        existing.push(p);
      } else {
        groups.set(mergeKey, [p]);
      }
    }

    const merged: ProjectItem[] = [];
    const keyMap = new Map<string, string[]>();

    for (const items of groups.values()) {
      if (items.length === 1) {
        const item = items[0]!;
        merged.push(item);
        keyMap.set(item.project_key, [item.project_key]);
      } else {
        const rep = { ...items[0]! };
        const allKeys: string[] = [];
        for (let i = 0; i < items.length; i++) {
          const it = items[i]!;
          allKeys.push(it.project_key);
          if (i > 0) {
            rep.session_count += it.session_count;
            rep.total_messages += it.total_messages;
            rep.total_input_tokens += it.total_input_tokens;
            rep.total_output_tokens += it.total_output_tokens;
            if (it.last_activity > rep.last_activity) {
              rep.last_activity = it.last_activity;
            }
          }
        }
        merged.push(rep);
        keyMap.set(rep.project_key, allKeys);
      }
    }

    merged.sort((a, b) => b.session_count - a.session_count);

    return { mergedProjects: merged, projectKeyMap: keyMap };
  }, [filteredProjects]);

  const filteredOverview = useMemo<ProjectOverview | null>(() => {
    if (!overview) return null;
    return mergedProjects.reduce<ProjectOverview>(
      (acc, p) => ({
        totalProjects: acc.totalProjects + 1,
        totalSessions: acc.totalSessions + p.session_count,
        totalMessages: acc.totalMessages + p.total_messages,
        totalInputTokens: acc.totalInputTokens + p.total_input_tokens,
        totalOutputTokens: acc.totalOutputTokens + p.total_output_tokens,
      }),
      {
        totalProjects: 0,
        totalSessions: 0,
        totalMessages: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      },
    );
  }, [overview, mergedProjects]);

  const mergedSourceDistribution = useMemo(() => {
    const result: Record<string, ProjectSourceCount[]> = {};
    for (const p of mergedProjects) {
      const allKeys = projectKeyMap.get(p.project_key) ?? [p.project_key];
      const combined: ProjectSourceCount[] = [];
      for (const k of allKeys) {
        const sources = sourceDistribution[k];
        if (sources) combined.push(...sources);
      }
      const bySource = new Map<string, number>();
      for (const s of combined) {
        bySource.set(s.source, (bySource.get(s.source) ?? 0) + s.count);
      }
      result[p.project_key] = Array.from(bySource.entries()).map(
        ([source, count]) => ({ source, count }) as ProjectSourceCount,
      );
    }
    return result;
  }, [mergedProjects, projectKeyMap, sourceDistribution]);

  const selectedProjectKeys = useMemo(() => {
    if (!selectedKey) return null;
    return projectKeyMap.get(selectedKey) ?? [selectedKey];
  }, [selectedKey, projectKeyMap]);

  const buildSessionsUrl = useCallback(() => {
    if (!selectedProjectKeys) return null;
    const params = new URLSearchParams();
    params.set("projectKey", selectedProjectKeys.join(","));
    params.set("sort", sessionsSort);
    params.set("page", String(sessionsPage));
    params.set("limit", String(sessionsPageSize));
    return `/api/sessions?${params.toString()}`;
  }, [selectedProjectKeys, sessionsSort, sessionsPage, sessionsPageSize]);

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
    if (selectedKey) {
      fetchSessions();
    }
  }, [selectedKey, fetchSessions]);

  useEffect(() => {
    if (
      selectedKey &&
      !mergedProjects.some((p) => p.project_key === selectedKey)
    ) {
      setSelectedKey(null);
      setSessions([]);
      setSessionsTotalCount(0);
    }
  }, [mergedProjects, selectedKey]);

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
        const apiSort = COLUMN_TO_SORT[newSorting[0]?.id ?? ""];
        if (apiSort) {
          setSessionsSort(apiSort);
          setSessionsPage(1);
        }
      }
    },
    [sorting],
  );

  const table = useTable({
    features: dataTableFeatures,
    data: sessions,
    columns,
    manualSorting: true,
    state: { sorting },
    onSortingChange,
    enableSortingRemoval: false,
    getRowId: (row) => row.id,
  });

  const selectedProject = mergedProjects.find(
    (p) => p.project_key === selectedKey,
  );

  const handleClose = useCallback(() => {
    setSelectedKey(null);
    setSessions([]);
    setSessionsTotalCount(0);
  }, []);

  return (
    <div className="flex flex-col gap-4" data-testid="projects-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight font-display">
          Projects
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Explore your coding projects and their session activity
        </p>
      </div>

      {error && (
        <div
          className="text-sm text-destructive py-4"
          data-testid="projects-error"
        >
          {error}
        </div>
      )}

      {!loading && projects.length > 0 && (
        <ProjectFilters
          minSessions={minSessions}
          scope={scope}
          onMinSessionsChange={setMinSessions}
          onScopeChange={setScope}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-10">
        <div className="lg:col-span-3 lg:flex lg:flex-col lg:h-full">
          {loading ? (
            <div className="flex flex-col gap-3" data-testid="projects-loading">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[96px] rounded-xl" />
              ))}
            </div>
          ) : mergedProjects.length === 0 ? (
            <div
              className="text-sm text-muted-foreground text-center py-12"
              data-testid="projects-empty"
            >
              {projects.length === 0
                ? "No projects found. Sessions will appear here once they have a project reference."
                : "No projects match the current filters."}
            </div>
          ) : (
            <ProjectSidebar
              projects={mergedProjects}
              sourceDistribution={mergedSourceDistribution}
              selectedKey={selectedKey}
              onProjectClick={handleProjectClick}
            />
          )}
        </div>

        <div className="lg:col-span-7 flex flex-col gap-4">
          {!loading && (
            <Collapsible open={overviewOpen} onOpenChange={setOverviewOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  data-testid="overview-toggle"
                  className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 transition-transform",
                      overviewOpen && "rotate-90",
                    )}
                  />
                  Overview
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="flex flex-col gap-4 pt-3">
                  {filteredOverview && (
                    <StatGrid columns={4}>
                      <StatCard
                        title="Total Projects"
                        value={filteredOverview.totalProjects.toLocaleString()}
                        icon={FolderKanban}
                        accentColor="bg-primary"
                      />
                      <StatCard
                        title="Total Sessions"
                        value={filteredOverview.totalSessions.toLocaleString()}
                        icon={Layers}
                        accentColor="bg-chart-3"
                      />
                      <StatCard
                        title="Total Tokens"
                        value={formatTokens(
                          filteredOverview.totalInputTokens +
                            filteredOverview.totalOutputTokens,
                        )}
                        icon={Coins}
                        accentColor="bg-chart-4"
                      />
                      <StatCard
                        title="Total Messages"
                        value={filteredOverview.totalMessages.toLocaleString()}
                        icon={MessageSquare}
                        accentColor="bg-chart-5"
                      />
                    </StatGrid>
                  )}
                  <ProjectRankingChart projects={mergedProjects} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {loading && (
            <div className="flex flex-col gap-4">
              <StatGrid columns={4}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-[88px] rounded-xl" />
                ))}
              </StatGrid>
              <Skeleton className="h-[380px] rounded-xl" />
            </div>
          )}

          <ProjectDetailPanel
            selectedKey={selectedKey}
            activityKeys={selectedProjectKeys?.join(",") ?? null}
            selectedProject={selectedProject}
            sessionsError={sessionsError}
            sessionsLoading={sessionsLoading}
            table={table}
            columns={columns}
            sessionsPage={sessionsPage}
            sessionsPageSize={sessionsPageSize}
            sessionsTotalCount={sessionsTotalCount}
            onPageChange={setSessionsPage}
            onPageSizeChange={setSessionsPageSize}
            onClose={handleClose}
          />
        </div>
      </div>
    </div>
  );
}
