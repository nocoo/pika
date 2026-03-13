"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  MessagesSquare,
  ArrowUpRight,
  Zap,
  Calendar,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { ActivityHeatmap } from "@/components/dashboard/activity-heatmap";
import { SourceChart } from "@/components/dashboard/source-chart";
import { RecentSessions } from "@/components/dashboard/recent-sessions";
import { TopProjects } from "@/components/dashboard/top-projects";
import { formatTokens } from "@/lib/utils";
import { buildHeatmapData } from "@/lib/format";
import type { StatsResponse } from "@/lib/stats";
import type { SessionRow } from "@/lib/sessions";

export default function DashboardPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [recent, setRecent] = useState<SessionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, sessionsRes] = await Promise.all([
          fetch("/api/stats"),
          fetch("/api/sessions?limit=10"),
        ]);

        if (!statsRes.ok) throw new Error(`Stats: ${statsRes.status}`);
        if (!sessionsRes.ok) throw new Error(`Sessions: ${sessionsRes.status}`);

        const statsData: StatsResponse = await statsRes.json();
        const sessionsData: { sessions: SessionRow[] } = await sessionsRes.json();

        setStats(statsData);
        setRecent(sessionsData.sessions);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const overview = stats?.overview;
  const heatmapData = stats ? buildHeatmapData(stats.dailyActivity) : [];

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
      {loading ? (
        <StatGrid>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </StatGrid>
      ) : (
        <StatGrid>
          <StatCard
            label="Total Sessions"
            value={String(overview?.totalSessions ?? 0)}
            subtitle={`${overview?.sessionsThisWeek ?? 0} this week`}
            icon={<LayoutDashboard className="h-4 w-4" strokeWidth={1.5} />}
          />
          <StatCard
            label="Total Messages"
            value={formatTokens(overview?.totalMessages ?? 0)}
            icon={<MessagesSquare className="h-4 w-4" strokeWidth={1.5} />}
          />
          <StatCard
            label="Input Tokens"
            value={formatTokens(overview?.totalInputTokens ?? 0)}
            icon={<ArrowUpRight className="h-4 w-4" strokeWidth={1.5} />}
          />
          <StatCard
            label="Output Tokens"
            value={formatTokens(overview?.totalOutputTokens ?? 0)}
            icon={<Zap className="h-4 w-4" strokeWidth={1.5} />}
          />
        </StatGrid>
      )}

      {/* Activity heatmap + Source chart row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Calendar className="h-4 w-4" strokeWidth={1.5} />
              Activity (last 90 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[100px] w-full rounded-lg" />
            ) : (
              <ActivityHeatmap data={heatmapData} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Sources
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[200px] w-full rounded-lg" />
            ) : (
              <SourceChart data={stats?.sourceDistribution ?? []} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent sessions + Top projects row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Recent Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <RecentSessions sessions={recent ?? []} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Top Projects
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <TopProjects projects={stats?.topProjects ?? []} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
