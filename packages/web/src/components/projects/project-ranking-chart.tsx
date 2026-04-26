import { BarChart3 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { projectDisplayName } from "@/lib/format";
import { projectColor } from "@/lib/palette";
import type { ProjectItem } from "@/lib/projects-types";

interface ProjectRankingChartProps {
  projects: ProjectItem[];
  className?: string;
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  color: "hsl(var(--popover-foreground))",
  fontSize: "12px",
};

export function ProjectRankingChart({
  projects,
  className,
}: ProjectRankingChartProps) {
  const top10 = projects.slice(0, 10);

  if (top10.length === 0) {
    return null;
  }

  const data = top10.map((p) => ({
    name: projectDisplayName(p.project_name, p.project_key),
    sessions: p.session_count,
    projectKey: p.project_key,
  }));

  return (
    <Card className={className} data-testid="project-ranking-chart">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          Top Projects by Sessions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                horizontal={false}
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
              <XAxis
                type="number"
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                width={120}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => [String(value), "sessions"]}
                cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
              />
              <Bar dataKey="sessions" radius={[0, 4, 4, 0]} barSize={20}>
                {data.map((entry) => (
                  <Cell
                    key={entry.projectKey}
                    fill={projectColor(entry.projectKey).color}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
