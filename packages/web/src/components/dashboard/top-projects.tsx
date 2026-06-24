import { Link } from "react-router";
import { ScopeBadge } from "@/components/ui/scope-badge";
import { parseProjectDisplay, projectDisplayName } from "@/lib/format";
import type { TopProject } from "@/lib/stats-types";
import { cn } from "@/lib/utils";

interface TopProjectsProps {
  projects: TopProject[];
  className?: string;
}

export function TopProjects({ projects, className }: TopProjectsProps) {
  if (projects.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center py-8 text-sm text-muted-foreground",
          className,
        )}
      >
        No projects found
      </div>
    );
  }

  const maxCount = Math.max(...projects.map((p) => p.count));

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {projects.map((project) => (
        <Link
          key={project.project_key}
          to={`/dashboard/sessions?projectKey=${encodeURIComponent(project.project_key)}`}
          className="group flex items-center gap-3 rounded-lg px-1 py-1.5 transition-colors hover:bg-background/50 -mx-1"
        >
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <p className="text-sm text-foreground truncate">
              {projectDisplayName(project.project_name, project.project_key)}
            </p>
            {(() => {
              const { scope } = parseProjectDisplay(project.project_name);
              return scope ? <ScopeBadge scope={scope} /> : null;
            })()}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-20 h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-primary/60"
                style={{ width: `${(project.count / maxCount) * 100}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground w-6 text-right">
              {project.count}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
