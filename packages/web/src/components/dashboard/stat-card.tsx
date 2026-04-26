import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  trend?: { value: number; label?: string };
  trends?: { value: number; label?: string }[] | undefined;
  variant?: "primary" | "secondary";
  accentColor?: string;
  className?: string;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = "text-muted-foreground",
  trend,
  trends,
  variant = "secondary",
  accentColor,
  className,
}: StatCardProps) {
  const allTrends = trends ?? (trend ? [trend] : []);
  const isPrimary = variant === "primary";

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary",
        isPrimary ? "p-5 md:p-6" : "p-4 md:p-5",
        className,
      )}
      data-testid="stat-card"
    >
      {(accentColor || isPrimary) && (
        <div
          className={cn(
            "h-0.5 w-8 rounded-full mb-4",
            accentColor ?? "bg-gradient-to-r from-primary to-chart-8",
          )}
        />
      )}

      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p
            className={cn(
              "text-muted-foreground",
              isPrimary
                ? "text-xs md:text-sm font-medium"
                : "text-xs md:text-sm",
            )}
          >
            {title}
          </p>
          <p
            className={cn(
              "font-semibold text-foreground font-display tracking-tight",
              isPrimary ? "text-3xl md:text-4xl" : "text-2xl md:text-3xl",
            )}
            data-testid="stat-value"
          >
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {Icon && (
          <div className={cn("rounded-md bg-background p-2", iconColor)}>
            <Icon
              className={cn(isPrimary ? "h-6 w-6" : "h-5 w-5")}
              strokeWidth={1.5}
            />
          </div>
        )}
      </div>
      {allTrends.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {allTrends.map((t, i) => {
            const isPos = t.value > 0;
            const isNeg = t.value < 0;
            return (
              <div key={i} className="flex items-center gap-1 text-xs">
                <span
                  className={cn(
                    "font-medium",
                    isPos && "text-success",
                    isNeg && "text-destructive",
                    !isPos && !isNeg && "text-muted-foreground",
                  )}
                >
                  {isPos && "+"}
                  {t.value}%
                </span>
                {t.label && (
                  <span className="text-muted-foreground">{t.label}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface StatGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

export function StatGrid({ children, columns = 4, className }: StatGridProps) {
  const gridCols = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  };

  return (
    <div className={cn("grid gap-3 md:gap-4", gridCols[columns], className)}>
      {children}
    </div>
  );
}
