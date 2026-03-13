"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { TopProject } from "@/lib/stats";

interface TopProjectsProps {
  projects: TopProject[];
  className?: string;
}

export function TopProjects({ projects, className }: TopProjectsProps) {
  if (projects.length === 0) {
    return (
      <div className={cn("flex items-center justify-center py-8 text-sm text-muted-foreground", className)}>
        No projects found
      </div>
    );
  }

  const maxCount = Math.max(...projects.map((p) => p.count));

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {projects.map((project) => (
        <Link
          key={project.project_ref}
          href={`/dashboard/sessions?project=${encodeURIComponent(project.project_ref)}`}
          className="group flex items-center gap-3 rounded-lg px-1 py-1.5 transition-colors hover:bg-accent/50 -mx-1"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground truncate">
              {project.project_name ?? project.project_ref}
            </p>
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
