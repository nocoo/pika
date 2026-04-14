"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────

interface ToolCallProps {
  toolName: string;
  toolInput?: string;
  toolResult?: string;
  className?: string;
}

// ── Shiki JSON highlight (reuse singleton from markdown-content) ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let highlighterPromise: Promise<any> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki/bundle/web").then((mod) =>
      mod.createHighlighter({
        themes: ["github-dark", "github-light"],
        langs: ["json"],
      }),
    );
  }
  return highlighterPromise!;
}

/** Highlighted JSON block — falls back to plain text while loading */
function HighlightedJson({ content }: { content: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const formatted = formatToolContent(content);

    // Only highlight if it looks like JSON
    if (!formatted.startsWith("{") && !formatted.startsWith("[")) {
      return;
    }

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
          // Keep fallback
        }
      })
      .catch(() => {
        // Keep fallback
      });

    return () => {
      cancelled = true;
    };
  }, [content]);

  if (html) {
    return (
      <div
        className="tool-call-shiki max-h-60 overflow-auto rounded-md text-xs [&_pre]:!bg-transparent [&_pre]:p-0 [&_pre]:m-0"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-foreground">
      {formatToolContent(content)}
    </pre>
  );
}

// ── ToolCall ───────────────────────────────────────────────────

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
          "rounded-lg border text-sm overflow-hidden transition-colors",
          hasResult
            ? "border-success/20 bg-success/5"
            : "border-border bg-secondary/50",
          className,
        )}
      >
        {/* Header — always visible */}
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
            !hasDetails && "cursor-default",
          )}
          disabled={!hasDetails}
        >
          {/* Chevron */}
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
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m8.25 4.5 7.5 7.5-7.5 7.5"
              />
            </svg>
          )}

          {/* Tool icon */}
          <svg
            className={cn(
              "size-3.5 shrink-0",
              hasResult ? "text-success" : "text-primary",
            )}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085"
            />
          </svg>

          <span className="truncate font-mono">{toolName}</span>
        </CollapsibleTrigger>

        {/* Expandable input/output with height transition */}
        <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
          <div className="border-t border-border">
            {toolInput && (
              <div className="px-3 py-2">
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

// ── Helpers ────────────────────────────────────────────────────

/** Try to pretty-print JSON content, or return raw string. */
function formatToolContent(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return content;
  }
}
