import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliTokensPage } from "./page";

const WAIT = { timeout: 2000 };

const tokenA = {
  id: 1,
  name: "laptop",
  token_prefix: "pk_abcd12",
  created_at: "2026-01-01T00:00:00Z",
  last_used_at: "2026-01-02T00:00:00Z",
  expires_at: null,
};

const tokenB = {
  id: 2,
  name: null,
  token_prefix: "pk_xyz789",
  created_at: "2026-01-03T00:00:00Z",
  last_used_at: null,
  expires_at: "2026-12-31T00:00:00Z",
};

let originalFetch: typeof fetch;

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

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("CliTokensPage", () => {
  it("renders loading skeletons initially", () => {
    mockFetch(() => new Promise(() => {}));
    render(<CliTokensPage />);
    expect(screen.getByTestId("cli-tokens-loading")).toBeTruthy();
    expect(screen.getByTestId("cli-page")).toBeTruthy();
  });

  it("shows error when initial fetch fails", async () => {
    mockFetch(() => jsonRes({}, 500));
    render(<CliTokensPage />);
    await waitFor(
      () => expect(screen.getByTestId("cli-tokens-error")).toBeTruthy(),
      WAIT,
    );
  });

  it("shows empty state when no tokens", async () => {
    mockFetch(() => jsonRes({ tokens: [] }));
    render(<CliTokensPage />);
    await waitFor(
      () => expect(screen.getByTestId("cli-tokens-empty")).toBeTruthy(),
      WAIT,
    );
  });

  it("renders list of tokens with prefix and dates", async () => {
    mockFetch(() => jsonRes({ tokens: [tokenA, tokenB] }));
    render(<CliTokensPage />);
    await waitFor(
      () => expect(screen.getByTestId("cli-tokens-list")).toBeTruthy(),
      WAIT,
    );
    expect(screen.getByTestId("cli-token-row-1")).toBeTruthy();
    expect(screen.getByTestId("cli-token-row-2")).toBeTruthy();
    expect(screen.getByText("laptop")).toBeTruthy();
    expect(screen.getByText(/pk_abcd12/)).toBeTruthy();
  });

  it("opens revoke dialog when revoke button is clicked", async () => {
    mockFetch(() => jsonRes({ tokens: [tokenA] }));
    render(<CliTokensPage />);
    await waitFor(
      () => expect(screen.getByTestId("cli-token-row-1")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId("cli-token-revoke-1"));
    await waitFor(
      () => expect(screen.getByTestId("cli-revoke-dialog")).toBeTruthy(),
      WAIT,
    );
  });

  it("revokes a token successfully and removes it from the list", async () => {
    let deleteCalled = false;
    mockFetch((url, init) => {
      if (init?.method === "DELETE") {
        deleteCalled = true;
        expect(url).toContain("/api/auth/tokens/1");
        return new Response(null, { status: 204 });
      }
      return jsonRes({ tokens: [tokenA] });
    });
    render(<CliTokensPage />);
    await waitFor(
      () => expect(screen.getByTestId("cli-token-row-1")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId("cli-token-revoke-1"));
    await waitFor(
      () => expect(screen.getByTestId("cli-revoke-confirm")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId("cli-revoke-confirm"));
    await waitFor(
      () => expect(screen.queryByTestId("cli-token-row-1")).toBeFalsy(),
      WAIT,
    );
    expect(deleteCalled).toBe(true);
  });

  it("shows revoke error when DELETE fails", async () => {
    mockFetch((_url, init) => {
      if (init?.method === "DELETE") {
        return jsonRes({ error: "boom" }, 500);
      }
      return jsonRes({ tokens: [tokenA] });
    });
    render(<CliTokensPage />);
    await waitFor(
      () => expect(screen.getByTestId("cli-token-row-1")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId("cli-token-revoke-1"));
    await waitFor(
      () => expect(screen.getByTestId("cli-revoke-confirm")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId("cli-revoke-confirm"));
    await waitFor(
      () => expect(screen.getByTestId("cli-revoke-error")).toBeTruthy(),
      WAIT,
    );
    // row still present
    expect(screen.getByTestId("cli-token-row-1")).toBeTruthy();
  });

  it("cancels the revoke dialog without deleting", async () => {
    let deleteCalled = false;
    mockFetch((_url, init) => {
      if (init?.method === "DELETE") {
        deleteCalled = true;
        return new Response(null, { status: 204 });
      }
      return jsonRes({ tokens: [tokenA] });
    });
    render(<CliTokensPage />);
    await waitFor(
      () => expect(screen.getByTestId("cli-token-row-1")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId("cli-token-revoke-1"));
    await waitFor(
      () => expect(screen.getByTestId("cli-revoke-cancel")).toBeTruthy(),
      WAIT,
    );
    fireEvent.click(screen.getByTestId("cli-revoke-cancel"));
    expect(deleteCalled).toBe(false);
    expect(screen.getByTestId("cli-token-row-1")).toBeTruthy();
  });

  it("renders install/auth informational cards", async () => {
    mockFetch(() => jsonRes({ tokens: [] }));
    render(<CliTokensPage />);
    await waitFor(
      () => expect(screen.getByTestId("cli-tokens-empty")).toBeTruthy(),
      WAIT,
    );
    expect(screen.getByTestId("cli-install-card")).toBeTruthy();
    expect(screen.getByTestId("cli-auth-card")).toBeTruthy();
    expect(screen.getByTestId("cli-tokens-card")).toBeTruthy();
  });
});
