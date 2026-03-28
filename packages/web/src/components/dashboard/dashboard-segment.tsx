import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// DashboardSegment — lightweight section divider for dashboard layout
// ---------------------------------------------------------------------------

export interface DashboardSegmentProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Visual section divider: small label + thin separator line + content.
 * No container / background — children keep their own styling.
 */
export function DashboardSegment({
  title,
  children,
  className,
}: DashboardSegmentProps) {
  return (
    <section className={cn("space-y-3 md:space-y-4", className)}>
      <div className="flex items-center gap-3">
        <h2 className="shrink-0 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        <div className="h-px flex-1 bg-border/60" />
      </div>
      {children}
    </section>
  );
}
