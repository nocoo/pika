import { Star } from "lucide-react";
import { useCallback, useState } from "react";
import { Link } from "react-router";
import { AgentBadge } from "@/components/ui/agent-badge";
import { Badge } from "@/components/ui/badge";
import { ModelBadge } from "@/components/ui/model-badge";
import { formatDuration, projectDisplayName, relativeTime } from "@/lib/format";
import type { SessionCardData } from "@/lib/sessions-types";
import { cn, formatTokens } from "@/lib/utils";

interface SessionCardProps {
  session: SessionCardData;
  className?: string;
}

export function SessionCard({ session, className }: SessionCardProps) {
  const totalTokens = session.total_input_tokens + session.total_output_tokens;
  const [starred, setStarred] = useState(session.is_starred === 1);
  const [pending, setPending] = useState(false);

  const toggleStar = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (pending) return;

      const next = !starred;
      setStarred(next);
      setPending(true);

      try {
        const res = await fetch(`/api/sessions/${session.id}/star`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ starred: next }),
        });
        if (!res.ok) setStarred(!next);
      } catch {
        setStarred(!next);
      } finally {
        setPending(false);
      }
    },
    [starred, pending, session.id],
  );

  return (
    <Link
      to={`/dashboard/sessions/${session.id}`}
      className={cn(
        "flex flex-col gap-2 rounded-[var(--radius-card)] bg-secondary p-4 transition-colors hover:bg-background/50",
        className,
      )}
      data-testid="session-card"
    >
      <div className="flex items-center justify-between">
        <AgentBadge source={session.source} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleStar}
            disabled={pending}
            className={cn(
              "flex items-center justify-center h-8 w-8 -mr-1.5 rounded-md transition-colors hover:bg-accent",
              starred
                ? "text-amber-500"
                : "text-muted-foreground/40 hover:text-amber-500/70",
            )}
            aria-label={starred ? "Unstar session" : "Star session"}
            data-testid="star-button"
          >
            <Star
              className="h-4 w-4"
              fill={starred ? "currentColor" : "none"}
            />
          </button>
          <span className="text-xs text-muted-foreground">
            {relativeTime(session.started_at)}
          </span>
        </div>
      </div>

      <h3 className="text-sm font-medium text-foreground truncate">
        {session.title ?? "Untitled session"}
      </h3>

      {session.tags && session.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {session.tags.map((tag) => (
            <Badge
              key={tag.id}
              variant="outline"
              className="text-micro px-1.5 py-0"
              style={
                tag.color
                  ? { borderColor: tag.color, color: tag.color }
                  : undefined
              }
            >
              {tag.name}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 min-w-0 text-xs text-muted-foreground">
        {session.project_name && (
          <span className="truncate">
            {projectDisplayName(session.project_name)}
          </span>
        )}
        {session.model && <ModelBadge model={session.model} />}
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 border-t border-border">
        <span>{session.total_messages} msgs</span>
        <span>{formatDuration(session.duration_seconds)}</span>
        <span>{formatTokens(totalTokens)} tokens</span>
      </div>
    </Link>
  );
}
