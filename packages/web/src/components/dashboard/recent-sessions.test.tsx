import type { Source } from "@pika/core";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { RecentSessions } from "./recent-sessions";

function makeSession(
  overrides: Partial<{
    id: string;
    source: Source;
    title: string | null;
    project_name: string | null;
    started_at: string;
    total_messages: number;
    duration_seconds: number;
    total_input_tokens: number;
    total_output_tokens: number;
  }> = {},
) {
  return {
    id: "s1",
    source: "claude-code" as Source,
    title: "Implement login flow",
    project_name: "@org/project",
    started_at: new Date().toISOString(),
    total_messages: 12,
    duration_seconds: 90,
    total_input_tokens: 1000,
    total_output_tokens: 500,
    ...overrides,
  };
}

function wrap(children: React.ReactNode) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("RecentSessions", () => {
  it("renders empty state when no sessions", () => {
    render(wrap(<RecentSessions sessions={[]} />));
    expect(screen.getByText(/No sessions yet/i)).toBeTruthy();
    expect(screen.getByText("pika sync")).toBeTruthy();
  });

  it("renders rows for each session with title", () => {
    render(
      wrap(
        <RecentSessions
          sessions={[
            makeSession({ id: "a", title: "Alpha" }),
            makeSession({ id: "b", title: "Beta" }),
          ]}
        />,
      ),
    );
    expect(screen.getAllByTestId("session-row").length).toBe(2);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("falls back to 'Untitled session' when title is null", () => {
    render(wrap(<RecentSessions sessions={[makeSession({ title: null })]} />));
    expect(screen.getByText("Untitled session")).toBeTruthy();
  });

  it("falls back to 'No project' when project_name is null", () => {
    render(
      wrap(<RecentSessions sessions={[makeSession({ project_name: null })]} />),
    );
    expect(screen.getByText(/No project/)).toBeTruthy();
  });

  it("renders session-source dot with sourceLabel as title", () => {
    render(
      wrap(
        <RecentSessions
          sessions={[makeSession({ source: "codex" as Source })]}
        />,
      ),
    );
    expect(screen.getByTestId("session-source").getAttribute("title")).toBe(
      "Codex CLI",
    );
  });

  it("links each row to /dashboard/sessions/<id>", () => {
    render(
      wrap(<RecentSessions sessions={[makeSession({ id: "abc-123" })]} />),
    );
    const link = screen.getByTestId("session-row").closest("a");
    expect(link?.getAttribute("href")).toBe("/dashboard/sessions/abc-123");
  });
});
