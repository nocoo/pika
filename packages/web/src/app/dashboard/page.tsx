"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Calendar,
  LayoutDashboard,
  MessagesSquare,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ActivityHeatmap } from "@/components/dashboard/activity-heatmap";
import { DashboardSegment } from "@/components/dashboard/dashboard-segment";
import type { Period } from "@/components/dashboard/period-selector";
import {
  PeriodSelector,
  periodLabel,
} from "@/components/dashboard/period-selector";
import { RecentSessions } from "@/components/dashboard/recent-sessions";
import { SourceChart } from "@/components/dashboard/source-chart";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { TopProjects } from "@/components/dashboard/top-projects";
import { Skeleton } from "@/components/ui/skeleton";
import type { SessionRow } from "@/lib/sessions";
import type { StatsResponse } from "@/lib/stats";
import { formatTokens } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Dashboard Skeleton
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6">
      {/* Heatmap Hero skeleton */}
      <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-6">
        <Skeleton className="h-5 w-24 mb-4" />
        <div className="flex items-start justify-between mb-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-5 w-48" />
          </div>
        </div>
        <Skeleton className="h-[120px] w-full" />
      </div>

      {/* Stat cards skeleton */}
      <StatGrid columns={4}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-[var(--radius-card)]" />
        ))}
      </StatGrid>

      {/* Charts skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3 md:gap-4">
        <Skeleton className="h-[200px] rounded-[var(--radius-card)]" />
        <Skeleton className="h-[200px] rounded-[var(--radius-card)]" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard Empty State
// ---------------------------------------------------------------------------

function DashboardEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="rounded-full bg-secondary p-4 mb-4">
        <LayoutDashboard className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold mb-2">No sessions yet</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Run{" "}
        <code className="px-1.5 py-0.5 rounded bg-secondary text-xs font-mono">
          pika sync
        </code>{" "}
        to start tracking your coding agent sessions.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Heatmap Hero Card
// ---------------------------------------------------------------------------

interface HeatmapHeroProps {
  data: { date: string; count: number }[];
  totalSessions: number;
  activeDays: number;
  loading?: boolean;
}

function HeatmapHero({
  data,
  totalSessions,
  activeDays,
  loading,
}: HeatmapHeroProps) {
  if (loading) {
    return (
      <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-6">
        <Skeleton className="h-5 w-24 mb-4" />
        <div className="flex items-start justify-between mb-4">
          <div className="space-y-2">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-5 w-48" />
          </div>
        </div>
        <Skeleton className="h-[140px] w-full" />
      </div>
    );
  }

  // Calculate days in the past year so far
  const daysInYear = 365;
  const activityRate =
    daysInYear > 0 ? Math.round((activeDays / daysInYear) * 100) : 0;

  return (
    <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-6">
      {/* Section title */}
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Activity
        </span>
      </div>

      {/* Header row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl md:text-4xl font-bold font-display tracking-tight text-foreground">
              {totalSessions.toLocaleString()}
            </span>
            <span className="text-sm text-muted-foreground">sessions</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Last 365 days · {activityRate}% active days
          </p>
        </div>
      </div>

      {/* Heatmap */}
      <ActivityHeatmap data={data} />

      {/* Footer stats */}
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-border/50 pt-4">
        <div className="flex items-center gap-2">
          <Calendar
            className="h-4 w-4 text-muted-foreground"
            strokeWidth={1.5}
          />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {activeDays}
            </span>
            <span className="text-xs text-muted-foreground">active days</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {activeDays > 0
                ? Math.round(totalSessions / activeDays).toLocaleString()
                : "0"}
            </span>
            <span className="text-xs text-muted-foreground">
              avg per active day
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [recent, setRecent] = useState<SessionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("365d");

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const [statsRes, sessionsRes] = await Promise.all([
          fetch(`/api/stats?period=${period}`),
          fetch("/api/sessions?limit=10"),
        ]);

        if (!statsRes.ok) throw new Error(`Stats: ${statsRes.status}`);
        if (!sessionsRes.ok) throw new Error(`Sessions: ${sessionsRes.status}`);

        const statsData: StatsResponse = await statsRes.json();
        const sessionsData: { sessions: SessionRow[] } =
          await sessionsRes.json();

        setStats(statsData);
        setRecent(sessionsData.sessions);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [period]);

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-destructive">
        {error}
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">
              Dashboard
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Overview of your coding agent sessions.
            </p>
          </div>
        </div>
        <DashboardSkeleton />
      </div>
    );
  }

  const overview = stats?.overview;
  const heatmapData = stats?.dailyActivity ?? [];

  // Empty state
  if (overview?.totalSessions === 0) {
    return (
      <div className="space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">
              Dashboard
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Overview of your coding agent sessions.
            </p>
          </div>
        </div>
        <DashboardEmptyState />
      </div>
    );
  }

  // Calculate active days from heatmap data
  const activeDays = heatmapData.filter((d) => d.count > 0).length;
  const subtitle = periodLabel(period);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Overview of your coding agent sessions.
          </p>
        </div>
      </div>

      {/* ── Hero: Year Activity Heatmap ────────────────────────── */}
      <HeatmapHero
        data={heatmapData}
        totalSessions={overview?.totalSessions ?? 0}
        activeDays={activeDays}
      />

      {/* ── Overview ───────────────────────────────────────────── */}
      <DashboardSegment
        title="Overview"
        action={<PeriodSelector value={period} onChange={setPeriod} />}
      >
        {/* Row 1 — Core metrics */}
        <StatGrid columns={4}>
          <StatCard
            title="Total Sessions"
            value={overview?.totalSessions ?? 0}
            subtitle={subtitle}
            icon={LayoutDashboard}
            iconColor="text-primary"
            variant="primary"
            accentColor="bg-gradient-to-r from-primary to-chart-8"
          />
          <StatCard
            title="Total Messages"
            value={formatTokens(overview?.totalMessages ?? 0)}
            subtitle="Conversations"
            icon={MessagesSquare}
            accentColor="bg-chart-3"
          />
          <StatCard
            title="Input Tokens"
            value={formatTokens(overview?.totalInputTokens ?? 0)}
            subtitle="Prompts & context"
            icon={ArrowDownToLine}
            accentColor="bg-chart-4"
          />
          <StatCard
            title="Output Tokens"
            value={formatTokens(overview?.totalOutputTokens ?? 0)}
            subtitle="Responses"
            icon={ArrowUpFromLine}
            accentColor="bg-chart-5"
          />
        </StatGrid>
      </DashboardSegment>

      {/* ── Breakdown ──────────────────────────────────────────── */}
      <DashboardSegment title="Breakdown">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3 md:gap-4">
          {/* Left: Recent sessions */}
          <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
            <p className="mb-3 text-xs md:text-sm text-muted-foreground">
              Recent Sessions
            </p>
            <RecentSessions sessions={recent ?? []} />
          </div>

          {/* Right: Source chart + Top projects stacked */}
          <div className="flex flex-col gap-3 md:gap-4">
            <SourceChart data={stats?.sourceDistribution ?? []} />

            <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 flex-1">
              <p className="mb-3 text-xs md:text-sm text-muted-foreground">
                Top Projects
              </p>
              <TopProjects projects={stats?.topProjects ?? []} />
            </div>
          </div>
        </div>
      </DashboardSegment>
    </div>
  );
}
