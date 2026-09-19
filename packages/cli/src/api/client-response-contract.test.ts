import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("CLI API response compatibility", () => {
  it.each([
    [
      new Response("ok", { status: 200 }),
      { ok: true, status: 200, error: undefined },
    ],
    [
      new Response(null, { status: 500, statusText: "Unavailable" }),
      { ok: false, status: 500, error: "Unavailable" },
    ],
    [
      Response.json({ message: "permission denied" }, { status: 403 }),
      { ok: false, status: 403, error: "permission denied" },
    ],
    [
      Response.json({}, { status: 400, statusText: "Bad Request" }),
      { ok: false, status: 400, error: "Bad Request" },
    ],
  ])(
    "normalizes HTTP response %# without issuing an extra request",
    async (response, expected) => {
      const fetcher = vi.fn().mockResolvedValue(response);
      vi.stubGlobal("fetch", fetcher);
      const client = new ApiClient({
        baseUrl: "https://unit.example.test/api//",
        getToken: () => undefined,
        retry: { maxAttempts: 1 },
      });
      expect(await client.get("sessions")).toEqual(expected);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0][0]).toBe(
        "https://unit.example.test/api/sessions",
      );
    },
  );

  it("normalizes a non-Error transport rejection", async () => {
    const fetchFn = vi.fn().mockRejectedValue("offline");
    const client = new ApiClient({
      baseUrl: "https://unit.example.test",
      getToken: () => undefined,
      fetchFn,
      retry: { maxAttempts: 1 },
    });
    expect(await client.get("/sessions")).toEqual({
      ok: false,
      status: 0,
      error: "Network error",
    });
  });
});
