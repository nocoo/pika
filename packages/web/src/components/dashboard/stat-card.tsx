"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// StatGrid
// ---------------------------------------------------------------------------

interface StatGridProps {
  children: React.ReactNode;
  className?: string;
}

export function StatGrid({ children, className }: StatGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatCard — basalt L2 style (bg-secondary, no border/shadow)
// ---------------------------------------------------------------------------

export interface StatCardProps {
  label: string;
  value: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  className?: string;
}

export function StatCard({
  label,
  value,
  subtitle,
  icon: Icon,
  iconColor = "text-muted-foreground",
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary p-4 md:p-5",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs md:text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl md:text-3xl font-semibold text-foreground font-display tracking-tight">
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {Icon && (
          <div className={cn("rounded-md bg-card p-2", iconColor)}>
            <Icon className="h-5 w-5" strokeWidth={1.5} />
          </div>
        )}
      </div>
    </div>
  );
}
