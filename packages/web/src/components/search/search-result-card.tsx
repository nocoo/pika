import type { Source } from "@pika/core";
import { Link } from "react-router";
import { AgentBadge } from "@/components/ui/agent-badge";
import { projectDisplayName, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface SearchResultData {
  session_id: string;
  message_id: string;
  ordinal: number;
  chunk_index: number;
  content_snippet: string;
  tool_snippet: string | null;
  session_key: string;
  source: Source;
  project_name: string | null;
  title: string | null;
  started_at: string;
}

interface SearchResultCardProps {
  result: SearchResultData;
  className?: string;
  onClick?: () => void;
  selected?: boolean;
  id?: string;
  "data-result-index"?: number;
}

function SearchResultCardInner({ result }: { result: SearchResultData }) {
  return (
    <>
      <div className="flex items-center justify-between">
        <AgentBadge source={result.source} />
        <span className="text-xs text-muted-foreground">
          {relativeTime(result.started_at)}
        </span>
      </div>

      <div className="flex items-center gap-2 min-w-0 text-sm">
        <span className="font-medium text-foreground truncate">
          {result.title ?? "Untitled session"}
        </span>
        {result.project_name && (
          <>
            <span className="text-border shrink-0">·</span>
            <span className="text-xs text-muted-foreground truncate">
              {projectDisplayName(result.project_name)}
            </span>
          </>
        )}
      </div>

      {result.content_snippet && (
        <div
          className="text-xs text-muted-foreground leading-relaxed line-clamp-3 [&>mark]:bg-primary/20 [&>mark]:text-foreground [&>mark]:rounded-sm [&>mark]:px-0.5"
          dangerouslySetInnerHTML={{ __html: result.content_snippet }}
          data-testid="search-snippet"
        />
      )}

      {result.tool_snippet && (
        <div className="border-t border-border pt-2 mt-1">
          <span className="text-micro font-medium uppercase tracking-wider text-muted-foreground/60">
            Tool context
          </span>
          <div
            className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-2 font-mono [&>mark]:bg-primary/20 [&>mark]:text-foreground [&>mark]:rounded-sm [&>mark]:px-0.5"
            dangerouslySetInnerHTML={{ __html: result.tool_snippet }}
            data-testid="search-tool-snippet"
          />
        </div>
      )}

      <div className="text-micro text-muted-foreground/60">
        Message #{result.ordinal + 1}
      </div>
    </>
  );
}

export function SearchResultCard({
  result,
  className,
  onClick,
  selected,
  id,
  "data-result-index": dataResultIndex,
}: SearchResultCardProps) {
  const cardClassName = cn(
    "flex flex-col gap-2 rounded-[var(--radius-card)] bg-secondary p-4 transition-colors hover:bg-background/50 text-left w-full",
    selected && "ring-2 ring-primary bg-accent/30",
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cardClassName}
        id={id}
        role="option"
        aria-selected={selected}
        data-result-index={dataResultIndex}
        data-testid="search-result"
      >
        <SearchResultCardInner result={result} />
      </button>
    );
  }

  return (
    <Link
      to={`/dashboard/sessions/${result.session_id}#msg-${result.ordinal}`}
      className={cardClassName}
      data-testid="search-result"
    >
      <SearchResultCardInner result={result} />
    </Link>
  );
}
