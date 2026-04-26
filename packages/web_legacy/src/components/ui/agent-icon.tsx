import type { Source } from "@pika/core";
import { cn } from "@/lib/utils";

// ── SVG paths for each agent brand ────────────────────────────

/** Anthropic / Claude — simplified sparkle mark */
function ClaudeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("size-4", className)}
    >
      <path d="M16.09 3 12 13.37 7.91 3H3l9 18 9-18h-4.91Z" />
    </svg>
  );
}

/** OpenAI / Codex — hexagonal aperture */
function CodexIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("size-4", className)}
    >
      <path d="M22.28 11.04 18.4 4.32a2.2 2.2 0 0 0-1.9-1.1h-7.76l1.1 1.9h6.66a.3.3 0 0 1 .26.15l3.88 6.73a.3.3 0 0 1 0 .3l-3.88 6.72a.3.3 0 0 1-.26.15H9.84l-1.1 1.9h7.76a2.2 2.2 0 0 0 1.9-1.1l3.88-6.72a2.2 2.2 0 0 0 0-2.2ZM7.5 18.18l-3.88-6.73a.3.3 0 0 1 0-.3L7.5 4.43a.3.3 0 0 1 .26-.15h1.1L5.94 9.73a2.2 2.2 0 0 0 0 2.2l2.93 5.07-1.1 1.9h-.01a.3.3 0 0 1-.26-.15v-.58ZM5.6 19.68l3.88-6.73L12 17.5l-2.52 4.37a2.2 2.2 0 0 1-1.9 1.1H1.72l1.1-1.9h4.78v.6Z" />
    </svg>
  );
}

/** Google / Gemini — four-point star */
function GeminiIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("size-4", className)}
    >
      <path d="M12 2C12 7.52 7.52 12 2 12c5.52 0 10 4.48 10 10 0-5.52 4.48-10 10-10-5.52 0-10-4.48-10-10Z" />
    </svg>
  );
}

/** OpenCode — terminal prompt */
function OpenCodeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

/** VS Code Copilot — dual-pane editor */
function CopilotIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
    >
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <polyline points="7.5 4.21 12 6.81 16.5 4.21" />
      <polyline points="7.5 19.79 7.5 14.6 3 12" />
      <polyline points="21 12 16.5 14.6 16.5 19.79" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

// ── AgentIcon ─────────────────────────────────────────────────

const ICON_MAP: Record<Source, React.FC<{ className?: string }>> = {
  "claude-code": ClaudeIcon,
  codex: CodexIcon,
  "gemini-cli": GeminiIcon,
  opencode: OpenCodeIcon,
  "vscode-copilot": CopilotIcon,
};

interface AgentIconProps {
  source: Source;
  className?: string;
}

export function AgentIcon({ source, className }: AgentIconProps) {
  const Icon = ICON_MAP[source];
  if (!Icon) {
    // Fallback — generic bot icon
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn("size-4", className)}
      >
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <circle cx="12" cy="5" r="4" />
      </svg>
    );
  }
  return <Icon className={className} />;
}
