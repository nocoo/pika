"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "@/lib/utils";
import { agentColor } from "@/lib/palette";
import { sourceLabel } from "@/lib/format";
import type { Source } from "@pika/core";

// ── Types ──────────────────────────────────────────────────────

interface SourceChartProps {
  data: { source: Source; count: number }[];
  className?: string;
}

// ── SourceChart ────────────────────────────────────────────────

export function SourceChart({ data, className }: SourceChartProps) {
  if (data.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-[200px] text-sm text-muted-foreground", className)}>
        No data yet
      </div>
    );
  }

  const chartData = data.map((d) => ({
    name: sourceLabel(d.source),
    value: d.count,
    fill: agentColor(d.source).color,
  }));

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
            >
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                color: "hsl(var(--popover-foreground))",
                fontSize: "12px",
              }}
              formatter={(value) => [String(value), "sessions"]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {data.map((d) => (
          <div key={d.source} className="flex items-center gap-1.5 text-xs">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: agentColor(d.source).color }}
            />
            <span className="text-muted-foreground">
              {sourceLabel(d.source)}
            </span>
            <span className="font-medium text-foreground">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
