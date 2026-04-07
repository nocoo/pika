"use client";

import {
  ArrowUpRight,
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

  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const overview = stats?.overview;
  const heatmapData = stats?.dailyActivity ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight font-display">
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of your coding agent sessions
        </p>
      </div>

      {/* Stat cards */}
      <DashboardSegment title="Overview">
        {loading ? (
          <StatGrid>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-[var(--radius-card)]" />
            ))}
          </StatGrid>
        ) : (
          <StatGrid>
            <StatCard
              label="Total Sessions"
              value={String(overview?.totalSessions ?? 0)}
              subtitle={`${overview?.sessionsThisWeek ?? 0} this week`}
              icon={LayoutDashboard}
            />
            <StatCard
              label="Total Messages"
              value={formatTokens(overview?.totalMessages ?? 0)}
              icon={MessagesSquare}
            />
            <StatCard
              label="Input Tokens"
              value={formatTokens(overview?.totalInputTokens ?? 0)}
              icon={ArrowUpRight}
            />
            <StatCard
              label="Output Tokens"
              value={formatTokens(overview?.totalOutputTokens ?? 0)}
              icon={Zap}
            />
          </StatGrid>
        )}
      </DashboardSegment>

      {/* Activity heatmap + Source chart row */}
      <DashboardSegment title="Activity">
        <div className="flex items-center justify-between mb-3">
          <p className="flex items-center gap-2 text-xs md:text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" strokeWidth={1.5} />
            {periodLabel(period)}
          </p>
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
            <p className="mb-3 text-xs md:text-sm text-muted-foreground">
              Activity
            </p>
            {loading ? (
              <Skeleton className="h-[100px] w-full" />
            ) : (
              <ActivityHeatmap data={heatmapData} />
            )}
          </div>

          <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
            <p className="mb-3 text-xs md:text-sm text-muted-foreground">
              Sources
            </p>
            {loading ? (
              <Skeleton className="h-[200px] w-full" />
            ) : (
              <SourceChart data={stats?.sourceDistribution ?? []} />
            )}
          </div>
        </div>
      </DashboardSegment>

      {/* Recent sessions + Top projects row */}
      <DashboardSegment title="Recent Activity">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
            {loading ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <RecentSessions sessions={recent ?? []} />
            )}
          </div>

          <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
            {loading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <TopProjects projects={stats?.topProjects ?? []} />
            )}
          </div>
        </div>
      </DashboardSegment>
    </div>
  );
}
