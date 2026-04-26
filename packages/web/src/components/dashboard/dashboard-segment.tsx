import { cn } from "@/lib/utils";

export interface DashboardSegmentProps {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function DashboardSegment({
  title,
  action,
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
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
