// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, apiJson, swrFetcher } from "./api";

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;
let reloadMock: ReturnType<typeof vi.fn>;
let originalLocation: Location | undefined;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  reloadMock = vi.fn();
  if (typeof window !== "undefined") {
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadMock },
    });
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalLocation) {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  }
});

function makeResponse(
  body: unknown,
  init: { status?: number; text?: boolean } = {},
) {
  const status = init.status ?? 200;
  const isText = init.text === true;
  const payload =
    body == null ? "" : isText ? String(body) : JSON.stringify(body);
  return new Response(payload, {
    status,
    headers: isText
      ? { "content-type": "text/plain" }
      : { "content-type": "application/json" },
  });
}

describe("apiFetch", () => {
  it("rejects relative paths that don't start with /", async () => {
    await expect(apiFetch("api/me")).rejects.toThrow(/must start with/);
  });

  it("forwards credentials: include", async () => {
    fetchMock.mockResolvedValue(makeResponse({ ok: true }));
    await apiFetch("/api/me");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("triggers reload on 401", async () => {
    fetchMock.mockResolvedValue(
      makeResponse({ error: "nope" }, { status: 401 }),
    );
    await apiFetch("/api/me");
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("skips reload when skipAuthReload=true", async () => {
    fetchMock.mockResolvedValue(
      makeResponse({ error: "nope" }, { status: 401 }),
    );
    await apiFetch("/api/me", { skipAuthReload: true });
    expect(reloadMock).not.toHaveBeenCalled();
  });
});

describe("apiJson", () => {
  it("parses JSON on 200", async () => {
    fetchMock.mockResolvedValue(makeResponse({ hello: "world" }));
    expect(await apiJson<{ hello: string }>("/api/x")).toEqual({
      hello: "world",
    });
  });

  it("returns undefined on 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await apiJson("/api/x")).toBeUndefined();
  });

  it("auto-sets content-type for non-FormData body", async () => {
    fetchMock.mockResolvedValue(makeResponse({ ok: true }));
    await apiJson("/api/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    const call = fetchMock.mock.calls[0]!;
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("does not set content-type for FormData body", async () => {
    fetchMock.mockResolvedValue(makeResponse({ ok: true }));
    const fd = new FormData();
    fd.append("a", "1");
    await apiJson("/api/x", { method: "POST", body: fd });
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("throws ApiError with message from {error: ...} body", async () => {
    fetchMock.mockResolvedValue(
      makeResponse({ error: "Bad thing" }, { status: 400 }),
    );
    await expect(apiJson("/api/x")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "Bad thing",
    });
  });

  it("throws ApiError with HTTP status when body is plain text", async () => {
    fetchMock.mockResolvedValue(
      makeResponse("oops", { status: 500, text: true }),
    );
    try {
      await apiJson("/api/x");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const e = err as ApiError;
      expect(e.status).toBe(500);
      expect(e.message).toBe("HTTP 500");
      expect(e.body).toBe("oops");
    }
  });

  it("falls back to HTTP {status} when body has no error field", async () => {
    fetchMock.mockResolvedValue(makeResponse({ data: 1 }, { status: 503 }));
    await expect(apiJson("/api/x")).rejects.toMatchObject({
      status: 503,
      message: "HTTP 503",
    });
  });

  it("returns undefined when 200 has empty body", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    expect(await apiJson("/api/x")).toBeUndefined();
  });
});

describe("swrFetcher", () => {
  it("delegates to apiJson", async () => {
    fetchMock.mockResolvedValue(makeResponse({ ok: 1 }));
    expect(await swrFetcher("/api/x")).toEqual({ ok: 1 });
  });
});
