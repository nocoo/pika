import { Badge } from "@/components/ui/badge";
import { agentColor } from "@/lib/palette";
import { sourceLabel } from "@/lib/format";
import type { Source } from "@pika/core";

interface AgentBadgeProps {
  source: Source;
  className?: string;
}

/**
 * Consistent agent badge with colored dot + label.
 * Uses the global `agentColor()` mapping for deterministic colors.
 */
export function AgentBadge({ source, className }: AgentBadgeProps) {
  const agent = agentColor(source);
  return (
    <Badge variant="secondary" className={className ?? "gap-1.5 text-xs font-normal"}>
      <span
        className="h-2 w-2 rounded-full shrink-0"
        style={{ backgroundColor: agent.color }}
      />
      {sourceLabel(source)}
    </Badge>
  );
}
