import type { Source } from "@pika/core";
import { type ColumnDef, flexRender, useTable } from "@tanstack/react-table";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  type DataTableFeatures,
  dataTableFeatures,
} from "@/components/ui/data-table-features";
import type { SessionCardData } from "@/lib/sessions-types";
import { getSessionColumns } from "./session-columns";

function row(overrides: Partial<SessionCardData> = {}): SessionCardData {
  return {
    id: "s1",
    session_key: "k1",
    source: "claude-code" as Source,
    started_at: "2024-01-01T00:00:00Z",
    last_message_at: "2024-01-01T01:00:00Z",
    duration_seconds: 90,
    user_messages: 1,
    assistant_messages: 2,
    total_messages: 3,
    total_input_tokens: 1500,
    total_output_tokens: 500,
    total_cached_tokens: 0,
    project_ref: null,
    project_name: null,
    model: "sonnet-4.6",
    title: "Hello",
    is_starred: 0,
    deleted_at: null,
    ...overrides,
  };
}

function Harness({
  data,
  columns,
}: {
  data: SessionCardData[];
  columns: ColumnDef<DataTableFeatures, SessionCardData, unknown>[];
}) {
  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    getRowId: (r) => r.id,
  });
  return (
    <table>
      <thead>
        {table.getHeaderGroups().map((g) => (
          <tr key={g.id}>
            {g.headers.map((h) => (
              <th key={h.id}>
                {h.isPlaceholder
                  ? null
                  : flexRender(h.column.columnDef.header, h.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((r) => (
          <tr key={r.id}>
            {r.getVisibleCells().map((c) => (
              <td key={c.id}>
                {flexRender(c.column.columnDef.cell, c.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

describe("getSessionColumns", () => {
  it("returns base columns without selection by default", () => {
    const cols = getSessionColumns(new Map(), () => {});
    expect(cols.length).toBe(8);
    expect(cols[0]?.id).toBe("source");
  });

  it("prepends selection column when enableSelection=true", () => {
    const cols = getSessionColumns(new Map(), () => {}, {
      enableSelection: true,
    });
    expect(cols.length).toBe(9);
    expect(cols[0]?.id).toBe("select");
  });

  it("updates row and page selection state", () => {
    const cols = getSessionColumns(new Map(), () => {}, {
      enableSelection: true,
    });
    render(
      <MemoryRouter>
        <Harness data={[row({ id: "a" }), row({ id: "b" })]} columns={cols} />
      </MemoryRouter>,
    );

    const selectAll = screen.getByLabelText("Select all");
    const [firstRow, secondRow] = screen.getAllByLabelText("Select row");
    fireEvent.click(firstRow!);
    expect(firstRow?.getAttribute("data-state")).toBe("checked");
    expect(selectAll.getAttribute("data-state")).toBe("indeterminate");

    fireEvent.click(selectAll);
    expect(firstRow?.getAttribute("data-state")).toBe("checked");
    expect(secondRow?.getAttribute("data-state")).toBe("checked");
    expect(selectAll.getAttribute("data-state")).toBe("checked");
  });

  it("renders title cell linking to session detail", () => {
    const cols = getSessionColumns(new Map(), () => {});
    render(
      <MemoryRouter>
        <Harness data={[row({ id: "abc", title: "Hi" })]} columns={cols} />
      </MemoryRouter>,
    );
    const link = screen.getByText("Hi").closest("a");
    expect(link?.getAttribute("href")).toBe("/dashboard/sessions/abc");
  });

  it("falls back to 'Untitled session' when title is null", () => {
    const cols = getSessionColumns(new Map(), () => {});
    render(
      <MemoryRouter>
        <Harness data={[row({ title: null })]} columns={cols} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Untitled session")).toBeTruthy();
  });

  it("starredMap overrides is_starred=0", () => {
    const cols = getSessionColumns(new Map([["s1", true]]), () => {});
    render(
      <MemoryRouter>
        <Harness data={[row({ is_starred: 0 })]} columns={cols} />
      </MemoryRouter>,
    );
    expect(
      screen.getByTestId("row-star-button").getAttribute("aria-label"),
    ).toBe("Unstar session");
  });

  it("calls onToggleStar with inverted starred when star button clicked", () => {
    const onToggle = vi.fn();
    const cols = getSessionColumns(new Map(), onToggle);
    render(
      <MemoryRouter>
        <Harness data={[row({ id: "x", is_starred: 0 })]} columns={cols} />
      </MemoryRouter>,
    );
    screen.getByTestId("row-star-button").click();
    expect(onToggle).toHaveBeenCalledWith("x", true);
  });

  it("formats total tokens via formatTokens", () => {
    const cols = getSessionColumns(new Map(), () => {});
    render(
      <MemoryRouter>
        <Harness
          data={[row({ total_input_tokens: 1500, total_output_tokens: 0 })]}
          columns={cols}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("1.5K")).toBeTruthy();
  });

  it("renders message count and source badge", () => {
    const cols = getSessionColumns(new Map(), () => {});
    render(
      <MemoryRouter>
        <Harness
          data={[row({ source: "codex" as Source, total_messages: 42 })]}
          columns={cols}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getAllByText("Codex CLI").length).toBeGreaterThan(0);
  });
});
