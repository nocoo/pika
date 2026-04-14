"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DashboardResponsiveContainer } from "@/components/dashboard/dashboard-responsive-container";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration } from "@/lib/format";
import { chart, chartAxis, chartMuted } from "@/lib/palette";
import type { ProjectDailyActivity } from "@/lib/projects";
import { cn, formatTokens } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectActivityChartProps {
  projectKey: string;
  className?: string;
}

type MetricKey = "sessions" | "messages" | "tokens" | "duration";

interface MetricConfig {
  key: MetricKey;
  label: string;
  color: string;
  format: (v: number) => string;
}

// ---------------------------------------------------------------------------
// Metric configurations
// ---------------------------------------------------------------------------

const METRICS: MetricConfig[] = [
  {
    key: "sessions",
    label: "Sessions",
    color: chart.gold,
    format: (v) => v.toLocaleString(),
  },
  {
    key: "messages",
    label: "Messages",
    color: chart.jade,
    format: (v) => v.toLocaleString(),
  },
  {
    key: "tokens",
    label: "Tokens",
    color: chart.sky,
    format: (v) => formatTokens(v),
  },
  {
    key: "duration",
    label: "Duration",
    color: chart.amber,
    format: (v) => formatDuration(v),
  },
];

// ---------------------------------------------------------------------------
// Date formatter
// ---------------------------------------------------------------------------

function formatXAxis(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function ChartTooltip({
  active,
  payload,
  label,
  primaryMetric,
  secondaryMetric,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    value: number;
    color: string;
    payload: ProjectDailyActivity;
  }>;
  label?: string;
  primaryMetric: MetricConfig;
  secondaryMetric: MetricConfig | null;
}) {
  if (!active || !payload?.length) return null;

  const data = payload[0]?.payload;
  if (!data) return null;

  const metrics = secondaryMetric
    ? [primaryMetric, secondaryMetric]
    : [primaryMetric];

  return (
    <div className="rounded-[var(--radius-widget)] bg-popover border border-border p-2.5 shadow-md">
      <p className="mb-1.5 text-xs font-medium text-foreground">
        {label ? formatXAxis(label) : ""}
      </p>
      <div className="flex flex-col gap-1">
        {metrics.map((metric) => (
          <div key={metric.key} className="flex items-center gap-2 text-xs">
            <div
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: metric.color }}
            />
            <span className="text-muted-foreground">{metric.label}</span>
            <span className="ml-auto font-medium text-foreground">
              {metric.format(data[metric.key])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric selector button
// ---------------------------------------------------------------------------

function MetricButton({
  metric,
  selected,
  secondary,
  onClick,
}: {
  metric: MetricConfig;
  selected: boolean;
  secondary: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
        selected
          ? "bg-secondary text-foreground shadow-sm"
          : secondary
            ? "bg-secondary/50 text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/30",
      )}
    >
      <div
        className={cn(
          "h-2 w-2 rounded-full",
          secondary && "ring-1 ring-foreground/50",
        )}
        style={{ backgroundColor: metric.color }}
      />
      {metric.label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ProjectActivityChart
// ---------------------------------------------------------------------------

export function ProjectActivityChart({
  projectKey,
  className,
}: ProjectActivityChartProps) {
  const [data, setData] = useState<ProjectDailyActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Primary metric (area) and optional secondary metric (line)
  const [primaryKey, setPrimaryKey] = useState<MetricKey>("sessions");
  const [secondaryKey, setSecondaryKey] = useState<MetricKey | null>(
    "messages",
  );

  const primaryMetric = METRICS.find((m) => m.key === primaryKey)!;
  const secondaryMetric = secondaryKey
    ? (METRICS.find((m) => m.key === secondaryKey) ?? null)
    : null;

  // Fetch data
  useEffect(() => {
    let cancelled = false;

    async function fetchActivity() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/projects/activity?projectKey=${encodeURIComponent(projectKey)}`,
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

  // Handle metric click: click selected primary -> deselect, click other -> swap roles
  const handleMetricClick = (key: MetricKey) => {
    if (key === primaryKey) {
      // Click on primary: if secondary exists, promote it to primary
      if (secondaryKey) {
        setPrimaryKey(secondaryKey);
        setSecondaryKey(null);
      }
    } else if (key === secondaryKey) {
      // Click on secondary: remove it
      setSecondaryKey(null);
    } else {
      // Click on unselected: make it secondary (or primary if no secondary)
      if (secondaryKey === null) {
        setSecondaryKey(key);
      } else {
        // Shift: secondary becomes primary, clicked becomes secondary
        setPrimaryKey(secondaryKey);
        setSecondaryKey(key);
      }
    }
  };

  // Normalize data for dual Y-axis (0-1 scale for secondary)
  const normalizedData = useMemo(() => {
    if (!secondaryMetric || data.length === 0) return data;

    const maxSecondary = Math.max(...data.map((d) => d[secondaryMetric.key]));
    if (maxSecondary === 0) return data;

    const maxPrimary = Math.max(...data.map((d) => d[primaryKey]));
    const scale = maxPrimary / maxSecondary;

    return data.map((d) => ({
      ...d,
      [`${secondaryMetric.key}_scaled`]: d[secondaryMetric.key] * scale,
    }));
  }, [data, primaryKey, secondaryMetric]);

  if (loading) {
    return (
      <Skeleton className={cn("h-[280px] w-full rounded-xl", className)} />
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "flex items-center justify-center h-[280px] rounded-[var(--radius-card)] bg-secondary text-sm text-destructive",
          className,
        )}
      >
        {error}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center h-[280px] rounded-[var(--radius-card)] bg-secondary text-sm text-muted-foreground",
          className,
        )}
      >
        No activity data
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className,
      )}
    >
      {/* Header: title + metric selectors */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs md:text-sm text-muted-foreground">
          Project Activity
        </p>
        <div className="flex items-center gap-1 flex-wrap">
          {METRICS.map((metric) => (
            <MetricButton
              key={metric.key}
              metric={metric}
              selected={metric.key === primaryKey}
              secondary={metric.key === secondaryKey}
              onClick={() => handleMetricClick(metric.key)}
            />
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="h-[220px]">
        <DashboardResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={normalizedData}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id="gradPrimary" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor={primaryMetric.color}
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor={primaryMetric.color}
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={chartAxis}
              strokeOpacity={0.15}
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: chartMuted }}
              tickFormatter={formatXAxis}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="primary"
              tick={{ fontSize: 11, fill: chartMuted }}
              tickFormatter={primaryMetric.format}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              width={48}
            />
            {secondaryMetric && (
              <YAxis
                yAxisId="secondary"
                orientation="right"
                tick={{ fontSize: 11, fill: chartMuted }}
                tickFormatter={secondaryMetric.format}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={48}
              />
            )}
            <Tooltip
              content={
                <ChartTooltip
                  primaryMetric={primaryMetric}
                  secondaryMetric={secondaryMetric}
                />
              }
              isAnimationActive={false}
            />
            {/* Primary metric: Area */}
            <Area
              yAxisId="primary"
              type="monotone"
              dataKey={primaryKey}
              stroke={primaryMetric.color}
              strokeWidth={2}
              fill="url(#gradPrimary)"
            />
            {/* Secondary metric: Line */}
            {secondaryMetric && (
              <Line
                yAxisId="secondary"
                type="monotone"
                dataKey={secondaryMetric.key}
                stroke={secondaryMetric.color}
                strokeWidth={2}
                dot={false}
                strokeDasharray="4 2"
              />
            )}
          </AreaChart>
        </DashboardResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div
            className="h-2 w-6 rounded-sm"
            style={{ backgroundColor: primaryMetric.color, opacity: 0.6 }}
          />
          <span>{primaryMetric.label} (area)</span>
        </div>
        {secondaryMetric && (
          <div className="flex items-center gap-1.5">
            <div
              className="h-0.5 w-6"
              style={{
                backgroundColor: secondaryMetric.color,
                borderTop: `2px dashed ${secondaryMetric.color}`,
              }}
            />
            <span>{secondaryMetric.label} (line)</span>
          </div>
        )}
      </div>
    </div>
  );
}
