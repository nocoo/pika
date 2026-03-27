import { Badge } from "@/components/ui/badge";
import type { ProjectScope } from "@/lib/format";

interface ScopeBadgeProps {
  scope: ProjectScope;
  className?: string;
}

const SCOPE_CONFIG: Record<ProjectScope, { label: string; className: string }> =
  {
    personal: {
      label: "Personal",
      className:
        "border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400",
    },
    work: {
      label: "Work",
      className:
        "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400",
    },
  };

/**
 * Scope badge for project cards — blue for personal, amber for work.
 * Follows the same pattern as AgentBadge.
 */
export function ScopeBadge({ scope, className }: ScopeBadgeProps) {
  const config = SCOPE_CONFIG[scope];
  return (
    <Badge
      variant="outline"
      className={className ?? `text-[10px] px-1.5 py-0 ${config.className}`}
    >
      {config.label}
    </Badge>
  );
}
