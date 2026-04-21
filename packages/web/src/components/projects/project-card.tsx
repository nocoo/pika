"use client";

import { Pie, PieChart, ResponsiveContainer } from "recharts";
import { ScopeBadge } from "@/components/ui/scope-badge";
import {
  parseProjectDisplay,
  projectDisplayName,
  relativeTime,
} from "@/lib/format";
import { agentColor } from "@/lib/palette";
import type { ProjectItem, ProjectSourceCount } from "@/lib/projects";
import { cn, formatTokens } from "@/lib/utils";

// ── MiniDonut ─────────────────────────────────────────────────

function MiniDonut({ sources }: { sources: ProjectSourceCount[] }) {
  if (sources.length === 0) return null;

  const data = sources.map((s) => ({
    value: s.count,
    fill: agentColor(s.source).color,
  }));

  return (
    <div className="h-9 w-9 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={12}
            outerRadius={18}
            paddingAngle={2}
            dataKey="value"
            stroke="none"
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── ProjectCard ───────────────────────────────────────────────

interface ProjectCardProps {
  project: ProjectItem;
  sources: ProjectSourceCount[];
  selected: boolean;
  onClick: () => void;
}

export function ProjectCard({
  project,
  sources,
  selected,
  onClick,
}: ProjectCardProps) {
  const totalTokens = project.total_input_tokens + project.total_output_tokens;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-[var(--radius-card)] bg-secondary p-4 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected && "bg-accent/30 ring-2 ring-primary",
      )}
    >
      <MiniDonut sources={sources} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-foreground truncate">
            {projectDisplayName(project.project_name, project.project_key)}
          </p>
          {(() => {
            const { scope } = parseProjectDisplay(project.project_name);
            return scope ? <ScopeBadge scope={scope} /> : null;
          })()}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span>{project.session_count} sessions</span>
          <span>{project.total_messages} msgs</span>
          <span>{formatTokens(totalTokens)} tokens</span>
        </div>
        <p className="text-xs text-muted-foreground/70 mt-1">
          {relativeTime(project.last_activity)}
        </p>
      </div>
    </button>
  );
}
