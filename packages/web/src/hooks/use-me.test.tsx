/// <reference types="@testing-library/jest-dom" />
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMe } from "./use-me";

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeResponse(body: unknown, status = 200) {
  return new Response(body == null ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function Wrapper({ children }: { children: ReactNode }) {
  // fresh provider/cache per test isolates state
  return (
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        revalidateOnMount: true,
      }}
    >
      {children}
    </SWRConfig>
  );
}

function Probe() {
  const { me, isLoading, isAuthenticated, error } = useMe();
  return (
    <div>
      <div data-testid="loading">{String(isLoading)}</div>
      <div data-testid="authed">{String(isAuthenticated)}</div>
      <div data-testid="email">{me?.email ?? ""}</div>
      <div data-testid="userId">{me?.userId ?? ""}</div>
      <div data-testid="error">{error?.message ?? ""}</div>
    </div>
  );
}

describe("useMe", () => {
  it("loading state on first render", () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    render(
      <Wrapper>
        <Probe />
      </Wrapper>,
    );
    expect(screen.getByTestId("loading").textContent).toBe("true");
    expect(screen.getByTestId("authed").textContent).toBe("false");
  });

  it("authenticated: hydrates email + userId", async () => {
    fetchMock.mockResolvedValue(
      makeResponse({ email: "a@x.com", userId: "u-1" }),
    );
    render(
      <Wrapper>
        <Probe />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false"),
    );
    expect(screen.getByTestId("authed").textContent).toBe("true");
    expect(screen.getByTestId("email").textContent).toBe("a@x.com");
    expect(screen.getByTestId("userId").textContent).toBe("u-1");
  });

  it("unauthenticated body (userId=null): isAuthenticated=false, no error", async () => {
    fetchMock.mockResolvedValue(makeResponse({ email: null, userId: null }));
    render(
      <Wrapper>
        <Probe />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false"),
    );
    expect(screen.getByTestId("authed").textContent).toBe("false");
    expect(screen.getByTestId("error").textContent).toBe("");
  });

  it("error state when fetch fails (non-401)", async () => {
    fetchMock.mockResolvedValue(makeResponse({ error: "Boom" }, 500));
    render(
      <Wrapper>
        <Probe />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toBe("Boom"),
    );
    expect(screen.getByTestId("authed").textContent).toBe("false");
  });
});
