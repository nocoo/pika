import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionDetailPage } from "./page";

function wrap(node: React.ReactNode, path = "/dashboard/sessions/abc") {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/dashboard/sessions/:id" element={node} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>
  );
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("SessionDetailPage", () => {
  it("renders loading skeletons initially", () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as typeof fetch;
    render(wrap(<SessionDetailPage />));
    expect(screen.getByTestId("session-detail-loading")).toBeTruthy();
  });

  it("renders 404 error message", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).startsWith("/api/sessions/")) {
        return new Response("not found", { status: 404 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    render(wrap(<SessionDetailPage />));
    await waitFor(() => {
      expect(screen.queryByTestId("session-detail-error")).toBeTruthy();
    });
    expect(screen.getByText("Session not found")).toBeTruthy();
  });

  it("renders session detail when API returns data", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u === "/api/me") {
        return new Response(JSON.stringify({ email: "a@b.io", userId: "u" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (u.startsWith("/api/sessions/abc")) {
        return new Response(
          JSON.stringify({
            session: {
              id: "abc",
              session_key: "k",
              source: "claude-code",
              started_at: "2024-01-01T00:00:00Z",
              last_message_at: "2024-01-01T01:00:00Z",
              duration_seconds: 60,
              user_messages: 1,
              assistant_messages: 1,
              total_messages: 2,
              total_input_tokens: 0,
              total_output_tokens: 0,
              total_cached_tokens: 0,
              project_ref: null,
              project_name: null,
              model: null,
              title: "T",
              summary: null,
              description: null,
              content_key: null,
              content_size: null,
              raw_key: null,
              raw_size: null,
              raw_hash: null,
              content_hash: null,
              is_starred: 0,
              deleted_at: null,
              snapshot_at: "2024-01-01T01:00:00Z",
              ingested_at: "2024-01-01T01:00:00Z",
            },
            contentUrl: null,
            rawUrl: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("nf", { status: 404 });
    }) as typeof fetch;

    render(wrap(<SessionDetailPage />));
    await waitFor(() => {
      expect(screen.queryByTestId("session-detail")).toBeTruthy();
    });
    expect(screen.getByText("T")).toBeTruthy();
    expect(screen.getByTestId("back-button")).toBeTruthy();
  });
});
