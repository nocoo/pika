import type { Source } from "@pika/core";
import { render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveInitials, MessageAvatar } from "./message-avatar";

function wrap(node: React.ReactNode) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {node}
    </SWRConfig>
  );
}

const originalFetch = globalThis.fetch;
const SYSTEM = "system" as const;
const USER = "user" as const;
const ASSISTANT = "assistant" as const;

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url) === "/api/me") {
      return new Response(
        JSON.stringify({ email: "alice@example.com", userId: "u-1" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("deriveInitials", () => {
  it("returns U for null", () => {
    expect(deriveInitials(null)).toBe("U");
    expect(deriveInitials(undefined)).toBe("U");
    expect(deriveInitials("")).toBe("U");
  });

  it("takes first 2 chars of local part uppercased", () => {
    expect(deriveInitials("alice@example.com")).toBe("AL");
    expect(deriveInitials("z@x.io")).toBe("Z");
  });

  it("returns U when no local part before @", () => {
    expect(deriveInitials("@oops.com")).toBe("U");
  });
});

describe("MessageAvatar", () => {
  it("renders system avatar (Info icon)", () => {
    render(
      wrap(<MessageAvatar role={SYSTEM} source={"claude-code" as Source} />),
    );
    expect(screen.getByTestId("system-avatar")).toBeTruthy();
  });

  it("renders user avatar with initials derived from email", async () => {
    render(
      wrap(<MessageAvatar role={USER} source={"claude-code" as Source} />),
    );
    const trigger = await screen.findByTestId("user-avatar-trigger");
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain("AL");
  });

  it("falls back to U initial when /api/me returns null email", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ email: null, userId: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as typeof fetch;
    render(wrap(<MessageAvatar role={USER} source={"codex" as Source} />));
    const trigger = await screen.findByTestId("user-avatar-trigger");
    expect(trigger.textContent).toContain("U");
  });

  it("renders assistant avatar (agent icon trigger)", () => {
    render(
      wrap(
        <MessageAvatar
          role={ASSISTANT}
          source={"codex" as Source}
          model="gpt-5"
          inputTokens={100}
          outputTokens={50}
          cachedTokens={20}
          timestamp="2024-01-01T12:00:00Z"
        />,
      ),
    );
    expect(screen.getByTestId("assistant-avatar-trigger")).toBeTruthy();
  });

  it("renders assistant avatar with no token info when both zero", () => {
    render(
      wrap(
        <MessageAvatar
          role={ASSISTANT}
          source={"claude-code" as Source}
          inputTokens={0}
          outputTokens={0}
        />,
      ),
    );
    expect(screen.getByTestId("assistant-avatar-trigger")).toBeTruthy();
  });
});
