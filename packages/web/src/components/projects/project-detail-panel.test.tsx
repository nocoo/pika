import { type ColumnDef, useTable } from "@tanstack/react-table";
import {
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DataTableFeatures,
  dataTableFeatures,
} from "@/components/ui/data-table-features";
import type { SessionCardData } from "@/lib/sessions-types";
import { ProjectDetailPanel } from "./project-detail-panel";

const project = {
  project_key: "k1",
  project_name: "/Users/me/personal/proj",
  session_count: 1,
  total_messages: 1,
  total_input_tokens: 0,
  total_output_tokens: 0,
  last_activity: "2026-01-01T00:00:00Z",
};

const columns: ColumnDef<DataTableFeatures, SessionCardData, unknown>[] = [
  { id: "id", header: "ID", accessorKey: "id" },
];

function useTestTable() {
  return useTable({
    features: dataTableFeatures,
    data: [],
    columns,
    getRowId: (row) => row.id,
  });
}

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(
    async () => new Response(JSON.stringify({ activity: [] })),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function Wrapper(
  props: Partial<React.ComponentProps<typeof ProjectDetailPanel>> & {
    selectedKey: string | null;
  },
) {
  const table = useTestTable();
  return (
    <ProjectDetailPanel
      selectedKey={props.selectedKey}
      activityKeys={props.activityKeys ?? null}
      selectedProject={props.selectedProject}
      sessionsError={props.sessionsError ?? null}
      sessionsLoading={props.sessionsLoading ?? false}
      table={table}
      columns={columns}
      sessionsPage={props.sessionsPage ?? 1}
      sessionsPageSize={props.sessionsPageSize ?? 25}
      sessionsTotalCount={props.sessionsTotalCount ?? 0}
      onPageChange={props.onPageChange ?? (() => {})}
      onPageSizeChange={props.onPageSizeChange ?? (() => {})}
      onClose={props.onClose ?? (() => {})}
    />
  );
}

describe("ProjectDetailPanel", () => {
  it("renders empty state without selection", () => {
    render(<Wrapper selectedKey={null} />);
    expect(screen.getByTestId("project-detail-empty")).toBeTruthy();
  });

  it("renders panel when a project is selected", async () => {
    render(<Wrapper selectedKey="k1" selectedProject={project} />);
    expect(screen.getByTestId("project-detail-panel")).toBeTruthy();
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <Wrapper selectedKey="k1" selectedProject={project} onClose={onClose} />,
    );
    fireEvent.click(screen.getByTestId("project-detail-close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows sessions error when present", () => {
    render(
      <Wrapper
        selectedKey="k1"
        selectedProject={project}
        sessionsError="Boom"
      />,
    );
    expect(screen.getByTestId("project-sessions-error")).toBeTruthy();
    expect(screen.getByText("Boom")).toBeTruthy();
  });

  it("uses activityKeys when provided", () => {
    render(
      <Wrapper
        selectedKey="k1"
        selectedProject={project}
        activityKeys="k1,k2"
      />,
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent("k1,k2")),
    );
  });

  // ensure useTestTable hook export not flagged as unused
  it("hook utility renders", () => {
    const { result } = renderHook(() => useTestTable());
    expect(result.current).toBeTruthy();
  });
});
