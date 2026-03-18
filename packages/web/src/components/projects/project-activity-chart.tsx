"use client";

import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { chartPrimary, withAlpha } from "@/lib/palette";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectDailyActivity } from "@/lib/projects";

// ── Types ──────────────────────────────────────────────────────

interface ProjectActivityChartProps {
  projectKey: string;
  className?: string;
}

// ── Tooltip style ─────────────────────────────────────────────

const tooltipStyle = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  color: "hsl(var(--popover-foreground))",
  fontSize: "12px",
};

// ── Date formatter ────────────────────────────────────────────

function formatXAxis(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── ProjectActivityChart ──────────────────────────────────────

export function ProjectActivityChart({
  projectKey,
  className,
}: ProjectActivityChartProps) {
  const [data, setData] = useState<ProjectDailyActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchActivity() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/projects/activity?project=${encodeURIComponent(projectKey)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: { activity: ProjectDailyActivity[] } = await res.json();
        if (!cancelled) {
          setData(json.activity);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load activity",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchActivity();
    return () => {
      cancelled = true;
    };
  }, [projectKey]);

  if (loading) {
    return <Skeleton className={`h-[200px] w-full rounded-xl ${className ?? ""}`} />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[200px] text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
        No activity data
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor={chartPrimary}
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor={chartPrimary}
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={formatXAxis}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              width={32}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => [String(value), "sessions"]}
              labelFormatter={(label) => formatXAxis(String(label))}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke={chartPrimary}
              strokeWidth={2}
              fill="url(#activityGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
