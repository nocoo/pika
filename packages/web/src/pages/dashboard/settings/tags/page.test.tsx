import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TagsSettingsPage } from "./page";

const originalFetch = globalThis.fetch;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
    handler(String(url), init),
  ) as typeof fetch;
}

const WAIT = { timeout: 2000 };

const sampleTag = {
  id: "t1",
  name: "alpha",
  color: "#ef4444",
  created_at: "2026-01-01T00:00:00Z",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("TagsSettingsPage", () => {
  it("renders loading skeletons initially", () => {
    mockFetch(async () => new Promise(() => {}));
    render(<TagsSettingsPage />);
    expect(screen.getByTestId("tags-loading")).toBeTruthy();
  });

  it("shows empty state when no tags", async () => {
    mockFetch(async () => jsonRes({ tags: [] }));
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-empty")).toBeTruthy(),
      WAIT,
    );
  });

  it("renders list of tags", async () => {
    mockFetch(async () => jsonRes({ tags: [sampleTag] }));
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-list")).toBeTruthy(),
      WAIT,
    );
    expect(screen.getByTestId(`tag-row-${sampleTag.id}`)).toBeTruthy();
    expect(screen.getByText("alpha")).toBeTruthy();
  });

  it("shows error when initial fetch fails", async () => {
    mockFetch(async () => new Response("nope", { status: 500 }));
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-error")).toBeTruthy(),
      WAIT,
    );
  });

  it("creates a new tag", async () => {
    let callCount = 0;
    mockFetch(async (url, init) => {
      callCount += 1;
      if (callCount === 1 && url === "/api/tags" && !init) {
        return jsonRes({ tags: [] });
      }
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return jsonRes({
          tag: {
            ...sampleTag,
            id: "new",
            name: body.name,
            color: body.color,
          },
        });
      }
      return jsonRes({ tags: [] });
    });
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-empty")).toBeTruthy(),
      WAIT,
    );

    fireEvent.change(screen.getByTestId("new-tag-name"), {
      target: { value: "beta" },
    });
    fireEvent.click(screen.getByTestId("new-tag-color-#22c55e"));
    expect(screen.getByTestId("new-tag-preview")).toBeTruthy();
    fireEvent.click(screen.getByTestId("new-tag-create"));

    await waitFor(() => expect(screen.queryByText("beta")).toBeTruthy(), WAIT);
  });

  it("create via Enter key works", async () => {
    mockFetch(async (_url, init) => {
      if (init?.method === "POST") {
        return jsonRes({
          tag: { ...sampleTag, id: "n2", name: "gamma", color: null },
        });
      }
      return jsonRes({ tags: [] });
    });
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-empty")).toBeTruthy(),
      WAIT,
    );
    const input = screen.getByTestId("new-tag-name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "gamma" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.queryByText("gamma")).toBeTruthy(), WAIT);
  });

  it("Enter no-op when name empty", async () => {
    mockFetch(async () => jsonRes({ tags: [] }));
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-empty")).toBeTruthy(),
      WAIT,
    );
    const input = screen.getByTestId("new-tag-name") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByTestId("tags-error")).toBeNull();
  });

  it("shows error from server when create fails (string error)", async () => {
    mockFetch(async (_url, init) => {
      if (init?.method === "POST") {
        return jsonRes({ error: "duplicate" }, 400);
      }
      return jsonRes({ tags: [] });
    });
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-empty")).toBeTruthy(),
      WAIT,
    );
    fireEvent.change(screen.getByTestId("new-tag-name"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByTestId("new-tag-create"));
    await waitFor(
      () =>
        expect(screen.getByTestId("tags-error").textContent).toContain(
          "duplicate",
        ),
      WAIT,
    );
  });

  it("shows fallback error when create fails with non-string", async () => {
    mockFetch(async (_url, init) => {
      if (init?.method === "POST") {
        return jsonRes({ error: { code: "x" } }, 400);
      }
      return jsonRes({ tags: [] });
    });
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-empty")).toBeTruthy(),
      WAIT,
    );
    fireEvent.change(screen.getByTestId("new-tag-name"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByTestId("new-tag-create"));
    await waitFor(
      () =>
        expect(screen.getByTestId("tags-error").textContent).toContain(
          "Failed to create tag",
        ),
      WAIT,
    );
  });

  it("edits a tag (Save)", async () => {
    mockFetch(async (_url, init) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        return jsonRes({
          tag: { ...sampleTag, name: body.name, color: body.color },
        });
      }
      return jsonRes({ tags: [sampleTag] });
    });
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-list")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId(`edit-tag-${sampleTag.id}`));
    const editInput = screen.getByTestId("edit-tag-name") as HTMLInputElement;
    fireEvent.change(editInput, { target: { value: "alpha2" } });
    // toggle a color and reset
    const colorBtns = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-label") === "Green");
    fireEvent.click(colorBtns[0]);
    fireEvent.click(screen.getByTestId("edit-tag-save"));
    await waitFor(
      () => expect(screen.queryByText("alpha2")).toBeTruthy(),
      WAIT,
    );
  });

  it("edit via Enter key", async () => {
    mockFetch(async (_url, init) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        return jsonRes({ tag: { ...sampleTag, name: body.name } });
      }
      return jsonRes({ tags: [sampleTag] });
    });
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-list")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId(`edit-tag-${sampleTag.id}`));
    const editInput = screen.getByTestId("edit-tag-name") as HTMLInputElement;
    fireEvent.change(editInput, { target: { value: "renamed" } });
    fireEvent.keyDown(editInput, { key: "Enter" });
    await waitFor(
      () => expect(screen.queryByText("renamed")).toBeTruthy(),
      WAIT,
    );
  });

  it("Escape cancels edit", async () => {
    mockFetch(async () => jsonRes({ tags: [sampleTag] }));
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-list")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId(`edit-tag-${sampleTag.id}`));
    const editInput = screen.getByTestId("edit-tag-name") as HTMLInputElement;
    fireEvent.keyDown(editInput, { key: "Escape" });
    expect(screen.queryByTestId("edit-tag-name")).toBeNull();
  });

  it("Cancel button exits edit mode", async () => {
    mockFetch(async () => jsonRes({ tags: [sampleTag] }));
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-list")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId(`edit-tag-${sampleTag.id}`));
    fireEvent.click(screen.getByTestId("edit-tag-cancel"));
    expect(screen.queryByTestId("edit-tag-name")).toBeNull();
  });

  it("edit no-op when name empty", async () => {
    mockFetch(async () => jsonRes({ tags: [sampleTag] }));
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-list")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId(`edit-tag-${sampleTag.id}`));
    fireEvent.change(screen.getByTestId("edit-tag-name"), {
      target: { value: "  " },
    });
    fireEvent.keyDown(screen.getByTestId("edit-tag-name"), { key: "Enter" });
    // still editing
    expect(screen.queryByTestId("edit-tag-name")).toBeTruthy();
  });

  it("edit clears editColor via no-color button", async () => {
    mockFetch(async (_url, init) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        return jsonRes({ tag: { ...sampleTag, color: body.color } });
      }
      return jsonRes({ tags: [sampleTag] });
    });
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-list")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId(`edit-tag-${sampleTag.id}`));
    const noColorBtns = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-label") === "No color");
    // click the edit-mode no-color button (last one rendered)
    fireEvent.click(noColorBtns[noColorBtns.length - 1]);
    fireEvent.click(screen.getByTestId("edit-tag-save"));
    await waitFor(
      () => expect(screen.queryByTestId("edit-tag-name")).toBeNull(),
      WAIT,
    );
  });

  it("shows server error on edit failure (string)", async () => {
    mockFetch(async (_url, init) => {
      if (init?.method === "PATCH") {
        return jsonRes({ error: "bad" }, 400);
      }
      return jsonRes({ tags: [sampleTag] });
    });
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-list")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId(`edit-tag-${sampleTag.id}`));
    fireEvent.click(screen.getByTestId("edit-tag-save"));
    await waitFor(
      () =>
        expect(screen.getByTestId("tags-error").textContent).toContain("bad"),
      WAIT,
    );
  });

  it("shows fallback error on edit failure (non-string)", async () => {
    mockFetch(async (_url, init) => {
      if (init?.method === "PATCH") {
        return jsonRes({ error: 42 }, 400);
      }
      return jsonRes({ tags: [sampleTag] });
    });
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-list")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId(`edit-tag-${sampleTag.id}`));
    fireEvent.click(screen.getByTestId("edit-tag-save"));
    await waitFor(
      () =>
        expect(screen.getByTestId("tags-error").textContent).toContain(
          "Failed to update tag",
        ),
      WAIT,
    );
  });

  it("deletes a tag", async () => {
    mockFetch(async (_url, init) => {
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return jsonRes({ tags: [sampleTag] });
    });
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-list")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId(`delete-tag-${sampleTag.id}`));
    await waitFor(
      () => expect(screen.queryByTestId("tags-empty")).toBeTruthy(),
      WAIT,
    );
  });

  it("shows error on delete failure", async () => {
    mockFetch(async (_url, init) => {
      if (init?.method === "DELETE") {
        return new Response("nope", { status: 500 });
      }
      return jsonRes({ tags: [sampleTag] });
    });
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-list")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId(`delete-tag-${sampleTag.id}`));
    await waitFor(
      () => expect(screen.queryByTestId("tags-error")).toBeTruthy(),
      WAIT,
    );
  });

  it("toggles new-tag color back to none", async () => {
    mockFetch(async () => jsonRes({ tags: [] }));
    render(<TagsSettingsPage />);
    await waitFor(
      () => expect(screen.queryByTestId("tags-empty")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId("new-tag-color-#3b82f6"));
    fireEvent.click(screen.getByTestId("new-tag-color-none"));
    fireEvent.change(screen.getByTestId("new-tag-name"), {
      target: { value: "z" },
    });
    expect(screen.getByTestId("new-tag-preview")).toBeTruthy();
  });
});
