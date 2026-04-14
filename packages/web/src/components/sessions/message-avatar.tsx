"use client";

import type { Source } from "@pika/core";
import { Info } from "lucide-react";
import { useSession } from "next-auth/react";
import { AgentIcon } from "@/components/ui/agent-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { ModelBadge } from "@/components/ui/model-badge";
import { sourceLabel } from "@/lib/format";
import { agentColor, withAlpha } from "@/lib/palette";
import { cn, formatTokens } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────

interface MessageAvatarProps {
  role: "user" | "assistant" | "system";
  source: Source;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  timestamp?: string;
}

// ── MessageAvatar ─────────────────────────────────────────────

export function MessageAvatar({
  role,
  source,
  model,
  inputTokens,
  outputTokens,
  cachedTokens,
  timestamp,
}: MessageAvatarProps) {
  if (role === "system") {
    return <SystemAvatar />;
  }

  if (role === "user") {
    return <UserAvatar />;
  }

  return (
    <AssistantAvatar
      source={source}
      model={model}
      inputTokens={inputTokens}
      outputTokens={outputTokens}
      cachedTokens={cachedTokens}
      timestamp={timestamp}
    />
  );
}

// ── User Avatar ───────────────────────────────────────────────

function UserAvatar() {
  const { data: session } = useSession();
  const user = session?.user;
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "U";

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <button type="button" className="shrink-0 focus:outline-none">
          <Avatar size="sm" className="size-7">
            {user?.image && (
              <AvatarImage src={user.image} alt={user.name ?? "User"} />
            )}
            <AvatarFallback className="bg-primary text-primary-foreground text-xs font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-56">
        <div className="flex items-center gap-3">
          <Avatar>
            {user?.image && (
              <AvatarImage src={user.image} alt={user.name ?? "User"} />
            )}
            <AvatarFallback className="bg-primary text-primary-foreground font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {user?.name ?? "User"}
            </p>
            {user?.email && (
              <p className="text-xs text-muted-foreground truncate">
                {user.email}
              </p>
            )}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

// ── Assistant Avatar ──────────────────────────────────────────

function AssistantAvatar({
  source,
  model,
  inputTokens,
  outputTokens,
  cachedTokens,
  timestamp,
}: {
  source: Source;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  timestamp?: string;
}) {
  const { color, token } = agentColor(source);
  const hasTokenInfo =
    (inputTokens && inputTokens > 0) || (outputTokens && outputTokens > 0);

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <button type="button" className="shrink-0 focus:outline-none">
          <div
            className="flex size-7 items-center justify-center rounded-full"
            style={{
              backgroundColor: withAlpha(token, 0.12),
              color,
            }}
          >
            <AgentIcon source={source} className="size-3.5" />
          </div>
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-64">
        <div className="flex flex-col gap-2">
          {/* Agent name */}
          <div className="flex items-center gap-2">
            <div
              className="flex size-8 items-center justify-center rounded-full"
              style={{
                backgroundColor: withAlpha(token, 0.12),
                color,
              }}
            >
              <AgentIcon source={source} className="size-4" />
            </div>
            <div>
              <p className="text-sm font-medium">{sourceLabel(source)}</p>
              {timestamp && (
                <p className="text-micro text-muted-foreground">
                  {new Date(timestamp).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </p>
              )}
            </div>
          </div>

          {/* Model badge */}
          {model && (
            <div className="flex items-center gap-1.5">
              <span className="text-micro text-muted-foreground">Model</span>
              <ModelBadge model={model} />
            </div>
          )}

          {/* Token usage */}
          {hasTokenInfo && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-micro text-muted-foreground">
              {inputTokens != null && inputTokens > 0 && (
                <span>
                  <span className="font-medium text-foreground">
                    {formatTokens(inputTokens)}
                  </span>{" "}
                  in
                </span>
              )}
              {outputTokens != null && outputTokens > 0 && (
                <span>
                  <span className="font-medium text-foreground">
                    {formatTokens(outputTokens)}
                  </span>{" "}
                  out
                </span>
              )}
              {cachedTokens != null && cachedTokens > 0 && (
                <span>
                  <span className="font-medium text-foreground">
                    {formatTokens(cachedTokens)}
                  </span>{" "}
                  cached
                </span>
              )}
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

// ── System Avatar ─────────────────────────────────────────────

function SystemAvatar() {
  return (
    <div
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full",
        "bg-muted text-muted-foreground",
      )}
    >
      <Info className="size-3.5" />
    </div>
  );
}
