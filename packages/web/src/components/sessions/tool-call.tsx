"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";

// ── Types ──────────────────────────────────────────────────────

interface ToolCallProps {
  toolName: string;
  toolInput?: string;
  toolResult?: string;
  className?: string;
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

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "rounded-lg border border-border bg-secondary/50 text-sm",
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
            className="size-3.5 shrink-0 text-primary"
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

        {/* Expandable input/output */}
        <CollapsibleContent>
          <div className="border-t border-border">
            {toolInput && (
              <div className="px-3 py-2">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Input
                </div>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-foreground">
                  {formatToolContent(toolInput)}
                </pre>
              </div>
            )}
            {toolResult && (
              <div className={cn("px-3 py-2", toolInput && "border-t border-border")}>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Output
                </div>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-foreground">
                  {formatToolContent(toolResult)}
                </pre>
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
