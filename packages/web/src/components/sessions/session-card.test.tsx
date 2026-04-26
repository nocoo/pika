import type { Source } from "@pika/core";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { SessionCardData } from "@/lib/sessions-types";
import { SessionCard } from "./session-card";

function makeSession(
  overrides: Partial<SessionCardData> = {},
): SessionCardData {
  return {
    id: "s1",
    session_key: "k1",
    source: "claude-code" as Source,
    started_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
    duration_seconds: 90,
    user_messages: 3,
    assistant_messages: 4,
    total_messages: 7,
    total_input_tokens: 1000,
    total_output_tokens: 500,
    total_cached_tokens: 0,
    project_ref: "ref-1",
    project_name: "myproject",
    model: "sonnet-4.6",
    title: "Implement login",
    is_starred: 0,
    deleted_at: null,
    ...overrides,
  };
}

function wrap(node: React.ReactNode) {
  return <MemoryRouter>{node}</MemoryRouter>;
}

describe("SessionCard", () => {
  it("renders title, project, model, message count", () => {
    render(wrap(<SessionCard session={makeSession()} />));
    expect(screen.getByText("Implement login")).toBeTruthy();
    expect(screen.getByText("myproject")).toBeTruthy();
    expect(screen.getByText("7 msgs")).toBeTruthy();
  });

  it("falls back to 'Untitled session' when title is null", () => {
    render(wrap(<SessionCard session={makeSession({ title: null })} />));
    expect(screen.getByText("Untitled session")).toBeTruthy();
  });

  it("links to /dashboard/sessions/<id>", () => {
    render(wrap(<SessionCard session={makeSession({ id: "abc" })} />));
    const link = screen.getByTestId("session-card");
    expect(link.getAttribute("href")).toBe("/dashboard/sessions/abc");
  });

  it("shows starred state when is_starred=1", () => {
    render(wrap(<SessionCard session={makeSession({ is_starred: 1 })} />));
    expect(screen.getByTestId("star-button").getAttribute("aria-label")).toBe(
      "Unstar session",
    );
  });

  it("shows unstarred state when is_starred=0", () => {
    render(wrap(<SessionCard session={makeSession({ is_starred: 0 })} />));
    expect(screen.getByTestId("star-button").getAttribute("aria-label")).toBe(
      "Star session",
    );
  });

  it("renders tag badges when tags are present", () => {
    render(
      wrap(
        <SessionCard
          session={makeSession({
            tags: [
              { id: "t1", name: "urgent", color: "#f00" },
              { id: "t2", name: "review", color: null },
            ],
          })}
        />,
      ),
    );
    expect(screen.getByText("urgent")).toBeTruthy();
    expect(screen.getByText("review")).toBeTruthy();
  });

  it("omits project span when project_name is null", () => {
    render(wrap(<SessionCard session={makeSession({ project_name: null })} />));
    expect(screen.queryByText("myproject")).toBeNull();
  });

  it("applies custom className", () => {
    render(wrap(<SessionCard session={makeSession()} className="my-card" />));
    expect(screen.getByTestId("session-card").className).toContain("my-card");
  });
});
