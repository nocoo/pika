"use client";

import { useMemo } from "react";
import { parseProjectDisplay } from "@/lib/format";
import type { ProjectScope } from "@/lib/format";
import { ProjectCard } from "@/components/projects/project-card";
import type { ProjectItem, ProjectSourceCount } from "@/lib/projects";

// ── Types ──────────────────────────────────────────────────────

interface ProjectSidebarProps {
  projects: ProjectItem[];
  sourceDistribution: Record<string, ProjectSourceCount[]>;
  selectedKey: string | null;
  onProjectClick: (key: string) => void;
}

interface ScopeGroup {
  label: string;
  scope: ProjectScope | null;
  projects: ProjectItem[];
}

// ── Constants ──────────────────────────────────────────────────

const SCOPE_ORDER: { scope: ProjectScope | null; label: string }[] = [
  { scope: "personal", label: "Personal" },
  { scope: "work", label: "Work" },
  { scope: null, label: "Other" },
];

// ── Component ──────────────────────────────────────────────────

export function ProjectSidebar({
  projects,
  sourceDistribution,
  selectedKey,
  onProjectClick,
}: ProjectSidebarProps) {
  const groups = useMemo<ScopeGroup[]>(() => {
    const buckets = new Map<ProjectScope | "other", ProjectItem[]>();
    buckets.set("personal", []);
    buckets.set("work", []);
    buckets.set("other", []);

    for (const p of projects) {
      const { scope } = parseProjectDisplay(p.project_name);
      const key = scope ?? "other";
      buckets.get(key)!.push(p);
    }

    return SCOPE_ORDER.map(({ scope, label }) => ({
      label,
      scope,
      projects: buckets.get(scope ?? "other") ?? [],
    })).filter((g) => g.projects.length > 0);
  }, [projects]);

  if (projects.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-12">
        No projects match filters.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-12rem)] lg:overflow-y-auto lg:pr-1">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
            {group.label}
          </h3>
          <div className="flex flex-col gap-2">
            {group.projects.map((project) => (
              <ProjectCard
                key={project.project_key}
                project={project}
                sources={sourceDistribution[project.project_key] ?? []}
                selected={selectedKey === project.project_key}
                onClick={() => onProjectClick(project.project_key)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
