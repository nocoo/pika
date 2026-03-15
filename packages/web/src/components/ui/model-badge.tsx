import { Badge } from "@/components/ui/badge";
import { modelColor, withAlpha } from "@/lib/palette";

interface ModelBadgeProps {
  model: string | null;
  className?: string;
}

/**
 * Consistent model badge with tinted color from the global `modelColor()` mapping.
 * Uses a deterministic hash-based color for each model name.
 */
export function ModelBadge({ model, className }: ModelBadgeProps) {
  if (!model) {
    return (
      <span className="text-sm text-muted-foreground">—</span>
    );
  }

  const { color, token } = modelColor(model);

  return (
    <Badge
      variant="outline"
      className={className ?? "text-xs font-normal whitespace-nowrap"}
      style={{
        borderColor: withAlpha(token, 0.4),
        color,
        backgroundColor: withAlpha(token, 0.08),
      }}
    >
      {model}
    </Badge>
  );
}
