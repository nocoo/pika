import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface ToolCallProps {
  toolName: string;
  toolInput?: string;
  toolResult?: string;
  className?: string;
}

let highlighterPromise: Promise<unknown> | null = null;

interface ShikiHighlighter {
  codeToHtml(
    code: string,
    options: { lang: string; themes: { dark: string; light: string } },
  ): string;
}

function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki/bundle/web").then((mod) =>
      mod.createHighlighter({
        themes: ["github-dark", "github-light"],
        langs: ["json"],
      }),
    );
  }
  return highlighterPromise as Promise<ShikiHighlighter>;
}

function HighlightedJson({ content }: { content: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const formatted = formatToolContent(content);

  useEffect(() => {
    let cancelled = false;
    if (!formatted.startsWith("{") && !formatted.startsWith("[")) return;

    getHighlighter()
      .then((hl) => {
        if (cancelled) return;
        try {
          const result = hl.codeToHtml(formatted, {
            lang: "json",
            themes: { dark: "github-dark", light: "github-light" },
          });
          setHtml(result);
        } catch {
          // keep fallback
        }
      })
      .catch(() => {
        // keep fallback
      });

    return () => {
      cancelled = true;
    };
  }, [formatted]);

  if (html) {
    return (
      <div
        className="tool-call-shiki max-h-60 overflow-auto rounded-md text-xs [&_pre]:!bg-transparent [&_pre]:p-0 [&_pre]:m-0"
        dangerouslySetInnerHTML={{ __html: html }}
        data-testid="tool-result-shiki"
      />
    );
  }

  return (
    <pre
      className="max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-foreground"
      data-testid="tool-result-fallback"
    >
      {formatted}
    </pre>
  );
}

export function ToolCall({
  toolName,
  toolInput,
  toolResult,
  className,
}: ToolCallProps) {
  const [open, setOpen] = useState(false);
  const hasDetails = Boolean(toolInput || toolResult);
  const hasResult = Boolean(toolResult);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "rounded-card text-sm overflow-hidden transition-colors",
          hasResult ? "border border-success/20 bg-success/5" : "bg-secondary",
          className,
        )}
        data-testid="tool-call"
      >
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
            !hasDetails && "cursor-default",
          )}
          disabled={!hasDetails}
          data-testid="tool-call-trigger"
        >
          {hasDetails && (
            <svg
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                open && "rotate-90",
              )}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m8.25 4.5 7.5 7.5-7.5 7.5"
              />
            </svg>
          )}
          <svg
            className={cn(
              "size-3.5 shrink-0",
              hasResult ? "text-success" : "text-primary",
            )}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877"
            />
          </svg>
          <span className="truncate font-mono">{toolName}</span>
        </CollapsibleTrigger>

        <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
          <div className="border-t border-border">
            {toolInput && (
              <div className="px-3 py-2" data-testid="tool-input">
                <Badge
                  variant="secondary"
                  className="mb-1.5 h-4 px-1.5 text-micro font-medium uppercase tracking-wider"
                >
                  Input
                </Badge>
                <HighlightedJson content={toolInput} />
              </div>
            )}
            {toolResult && (
              <div
                className={cn(
                  "px-3 py-2",
                  toolInput && "border-t border-border",
                )}
                data-testid="tool-output"
              >
                <Badge
                  variant="secondary"
                  className="mb-1.5 h-4 px-1.5 text-micro font-medium uppercase tracking-wider"
                >
                  Output
                </Badge>
                <HighlightedJson content={toolResult} />
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function formatToolContent(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return content;
  }
}
