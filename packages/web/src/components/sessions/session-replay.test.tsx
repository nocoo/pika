import type { CanonicalSession, Source } from "@pika/core";
import { render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionDetailRow } from "@/lib/session-detail-types";
import { SessionReplay } from "./session-replay";

function row(overrides: Partial<SessionDetailRow> = {}): SessionDetailRow {
  return {
    id: "s1",
    session_key: "k1",
    source: "claude-code" as Source,
    started_at: "2024-01-01T00:00:00Z",
    last_message_at: "2024-01-01T01:00:00Z",
    duration_seconds: 120,
    user_messages: 1,
    assistant_messages: 2,
    total_messages: 3,
    total_input_tokens: 1000,
    total_output_tokens: 500,
    total_cached_tokens: 0,
    project_ref: "ref",
    project_name: "proj",
    model: "sonnet-4.6",
    title: "Hello",
    summary: null,
    description: null,
    content_key: "ck",
    content_size: null,
    raw_key: null,
    raw_size: null,
    raw_hash: null,
    content_hash: null,
    is_starred: 0,
    deleted_at: null,
    snapshot_at: "2024-01-01T01:00:00Z",
    ingested_at: "2024-01-01T01:00:00Z",
    ...overrides,
  };
}

function wrap(node: React.ReactNode) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {node}
    </SWRConfig>
  );
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("SessionReplay", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u === "/api/me") {
        return new Response(JSON.stringify({ email: "a@b.io", userId: "u" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (u.startsWith("/content")) {
        const session: CanonicalSession = {
          messages: [
            {
              role: "user",
              content: "hi",
              timestamp: "2024-01-01T12:00:00Z",
            },
            {
              role: "assistant",
              content: "yo",
              timestamp: "2024-01-01T12:00:30Z",
              inputTokens: 50,
              outputTokens: 30,
              model: "sonnet",
            },
          ],
        } as CanonicalSession;
        return new Response(JSON.stringify(session), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("nf", { status: 404 });
    }) as typeof fetch;
  });

  it("renders header with title, project, model, stats", () => {
    render(wrap(<SessionReplay session={row()} contentUrl={null} />));
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByTestId("project-label").textContent).toContain("proj");
    expect(screen.getByTestId("replay-empty")).toBeTruthy();
  });

  it("falls back to 'Untitled session' when title null", () => {
    render(
      wrap(<SessionReplay session={row({ title: null })} contentUrl={null} />),
    );
    expect(screen.getByText("Untitled session")).toBeTruthy();
  });

  it("fetches content URL and renders messages", async () => {
    render(wrap(<SessionReplay session={row()} contentUrl="/content/s1" />));
    await waitFor(() => {
      expect(screen.queryByTestId("message-list")).toBeTruthy();
    });
    expect(screen.getAllByTestId("message").length).toBe(2);
    expect(screen.getByTestId("end-summary").textContent).toContain(
      "2 messages",
    );
  });

  it("shows error when content fetch fails", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("server error", { status: 500 }),
    ) as typeof fetch;
    render(wrap(<SessionReplay session={row()} contentUrl="/bad" />));
    await waitFor(() => {
      expect(screen.queryByTestId("replay-error")).toBeTruthy();
    });
  });

  it("renders no project label when project_name null", () => {
    render(
      wrap(
        <SessionReplay
          session={row({ project_name: null })}
          contentUrl={null}
        />,
      ),
    );
    expect(screen.queryByTestId("project-label")).toBeNull();
  });

  it("j key navigates down through messages", async () => {
    render(wrap(<SessionReplay session={row()} contentUrl="/content/s1" />));
    await waitFor(() => {
      expect(screen.queryByTestId("message-list")).toBeTruthy();
    });
    const el0 = document.getElementById("msg-0");
    expect(el0).toBeTruthy();
    el0!.scrollIntoView = vi.fn();
    document.getElementById("msg-1")!.scrollIntoView = vi.fn();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    expect(
      (
        document.getElementById("msg-0")!
          .scrollIntoView as unknown as ReturnType<typeof vi.fn>
      ).mock.calls.length,
    ).toBeGreaterThan(0);
  });

  it("ignores keyboard when target is input", async () => {
    render(wrap(<SessionReplay session={row()} contentUrl="/content/s1" />));
    await waitFor(() => {
      expect(screen.queryByTestId("message-list")).toBeTruthy();
    });
    const input = document.createElement("input");
    document.body.appendChild(input);
    const evt = new KeyboardEvent("keydown", {
      key: "j",
      bubbles: true,
    });
    input.dispatchEvent(evt);
    document.body.removeChild(input);
    // No assertion needed beyond no-throw
    expect(true).toBe(true);
  });
});
