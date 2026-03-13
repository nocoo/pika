"use client";

import { cn } from "@/lib/utils";
import type { HeatmapDay } from "@/lib/format";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ── Heatmap level → CSS class ──────────────────────────────────

const LEVEL_CLASSES: Record<number, string> = {
  0: "bg-secondary",
  1: "bg-heatmap-green-1",
  2: "bg-heatmap-green-2",
  3: "bg-heatmap-green-3",
  4: "bg-heatmap-green-4",
};

// ── ActivityHeatmap ────────────────────────────────────────────

interface ActivityHeatmapProps {
  data: HeatmapDay[];
  className?: string;
}

export function ActivityHeatmap({ data, className }: ActivityHeatmapProps) {
  // Group into weeks (columns of 7)
  const weeks: HeatmapDay[][] = [];
  for (let i = 0; i < data.length; i += 7) {
    weeks.push(data.slice(i, i + 7));
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <TooltipProvider delayDuration={0}>
        <div className="flex gap-[3px] overflow-x-auto">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {week.map((day) => (
                <Tooltip key={day.date}>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "h-3 w-3 rounded-sm transition-colors",
                        LEVEL_CLASSES[day.level] ?? LEVEL_CLASSES[0],
                      )}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={4}>
                    <span className="text-xs">
                      {day.count} session{day.count !== 1 ? "s" : ""} on{" "}
                      {day.date}
                    </span>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          ))}
        </div>
      </TooltipProvider>

      {/* Legend */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className={cn(
              "h-3 w-3 rounded-sm",
              LEVEL_CLASSES[level],
            )}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
