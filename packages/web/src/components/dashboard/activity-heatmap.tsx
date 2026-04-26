import { useMemo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  computePercentileBoundaries,
  formatDateISO,
  getColorIndex,
  getLast365DaysWeeks,
} from "@/lib/calendar-helpers";
import { cn } from "@/lib/utils";

export interface HeatmapDataPoint {
  date: string;
  count: number;
}

interface ActivityHeatmapProps {
  data: HeatmapDataPoint[];
  className?: string;
}

const heatmapColorScale = [
  "hsl(var(--muted))",
  "hsl(var(--heatmap-green-1))",
  "hsl(var(--heatmap-green-2))",
  "hsl(var(--heatmap-green-3))",
  "hsl(var(--heatmap-green-4))",
] as const;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const CELL_SIZE = 12;
const CELL_GAP = 2;

export function ActivityHeatmap({ data, className }: ActivityHeatmapProps) {
  const { weeks, dataMap, boundaries, monthLabels } = useMemo(() => {
    const weeks = getLast365DaysWeeks();
    const dataMap = new Map<string, number>();
    const nonZeroValues: number[] = [];

    for (const d of data) {
      dataMap.set(d.date, d.count);
      if (d.count > 0) nonZeroValues.push(d.count);
    }

    nonZeroValues.sort((a, b) => a - b);
    const levels = heatmapColorScale.length - 1;
    const boundaries = computePercentileBoundaries(nonZeroValues, levels);

    const monthLabels: { month: string; weekIndex: number }[] = [];
    let lastMonth = -1;

    for (let weekIndex = 0; weekIndex < weeks.length; weekIndex++) {
      const week = weeks[weekIndex];
      if (!week || week.length === 0) continue;

      const firstDayOfWeek = week[0];
      if (firstDayOfWeek) {
        const month = firstDayOfWeek.getMonth();
        if (month !== lastMonth) {
          monthLabels.push({ month: MONTHS[month] as string, weekIndex });
          lastMonth = month;
        }
      }
    }

    return { weeks, dataMap, boundaries, monthLabels };
  }, [data]);

  const labelWidth = 30;

  return (
    <div className={cn("overflow-x-auto", className)}>
      <TooltipProvider delayDuration={0}>
        <div className="inline-block">
          <div
            className="relative h-4 text-xs text-muted-foreground mb-1"
            style={{ marginLeft: labelWidth }}
          >
            {monthLabels.map((label, i) => (
              <div
                key={i}
                className="absolute"
                style={{ left: label.weekIndex * (CELL_SIZE + CELL_GAP) }}
              >
                {label.month}
              </div>
            ))}
          </div>

          <div className="flex">
            <div
              className="flex flex-col text-xs text-muted-foreground mr-1"
              style={{ width: labelWidth }}
            >
              {WEEKDAYS.map((day, i) => (
                <div
                  key={day}
                  style={{
                    height: CELL_SIZE + CELL_GAP,
                    lineHeight: `${CELL_SIZE + CELL_GAP}px`,
                    visibility: i % 2 === 1 ? "visible" : "hidden",
                  }}
                >
                  {day}
                </div>
              ))}
            </div>

            <div
              className="flex"
              style={{ gap: CELL_GAP }}
              role="img"
              aria-label="Activity heatmap"
            >
              {weeks.map((week, weekIndex) => (
                <div
                  key={weekIndex}
                  className="flex flex-col"
                  style={{ gap: CELL_GAP }}
                >
                  {week.map((date, dayIndex) => {
                    const dateStr = formatDateISO(date);
                    const value = dataMap.get(dateStr) ?? 0;
                    const colorIndex = getColorIndex(
                      value,
                      boundaries,
                      heatmapColorScale,
                    );

                    return (
                      <Tooltip key={dayIndex}>
                        <TooltipTrigger asChild>
                          <div
                            className={cn(
                              "rounded-sm cursor-pointer transition-colors hover:ring-1 hover:ring-foreground",
                              colorIndex === 0 && "border border-border/60",
                            )}
                            style={{
                              width: CELL_SIZE,
                              height: CELL_SIZE,
                              backgroundColor: heatmapColorScale[colorIndex],
                            }}
                            role="img"
                            aria-label={`${value} session${value !== 1 ? "s" : ""} on ${dateStr}`}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={4}>
                          <div className="text-sm">
                            <div className="font-medium">{dateStr}</div>
                            <div className="text-muted-foreground">
                              {value} session{value !== 1 ? "s" : ""}
                            </div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-1 mt-2 text-xs text-muted-foreground">
            <span>Less</span>
            {heatmapColorScale.map((color, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-sm",
                  i === 0 && "border border-border/60",
                )}
                style={{
                  width: CELL_SIZE,
                  height: CELL_SIZE,
                  backgroundColor: color,
                }}
              />
            ))}
            <span>More</span>
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
