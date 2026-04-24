import { describe, expect, it, vi } from "vitest";
import {
  buildRawR2Key,
  getProxyConfig,
  parseContentPath,
  proxyToWorker,
  validatePresignRequest,
} from "./ingest";

describe("proxyToWorker", () => {
  it("forwards method, path, headers, and body", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const result = await proxyToWorker(
      { workerUrl: "https://w.example", workerSecret: "s" },
      {
        method: "POST",
        path: "/ingest/sessions",
        userId: "u1",
        body: '{"a":1}',
        contentType: "application/json",
        extraHeaders: { "X-Content-Hash": "abc" },
      },
      fetchFn,
    );
    expect(result).toEqual({ status: 200, body: '{"ok":true}' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://w.example/ingest/sessions");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer s",
      "X-User-Id": "u1",
      "Content-Type": "application/json",
      "X-Content-Hash": "abc",
    });
    expect(init.body).toBe('{"a":1}');
  });

  it("returns 502 envelope when fetch throws", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await proxyToWorker(
      { workerUrl: "https://w.example", workerSecret: "s" },
      { method: "GET", path: "/x", userId: "u", body: null },
      fetchFn,
    );
    expect(result.status).toBe(502);
    expect(JSON.parse(result.body)).toEqual({
      error: "Worker proxy error: ECONNREFUSED",
    });
  });

  it("stringifies non-Error rejections", async () => {
    const fetchFn = vi.fn().mockRejectedValue("nope");
    const result = await proxyToWorker(
      { workerUrl: "https://w.example", workerSecret: "s" },
      { method: "GET", path: "/x", userId: "u", body: null },
      fetchFn,
    );
    expect(JSON.parse(result.body).error).toContain("nope");
  });

  it("omits Content-Type when not given", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    await proxyToWorker(
      { workerUrl: "https://w.example", workerSecret: "s" },
      { method: "DELETE", path: "/x", userId: "u", body: null },
      fetchFn,
    );
    expect(fetchFn.mock.calls[0][1].headers["Content-Type"]).toBeUndefined();
  });
});

describe("getProxyConfig", () => {
  it("throws when WORKER_URL missing", () => {
    delete process.env.WORKER_URL;
    process.env.WORKER_SECRET = "s";
    expect(() => getProxyConfig()).toThrow("WORKER_URL");
  });
  it("throws when WORKER_SECRET missing", () => {
    process.env.WORKER_URL = "https://w";
    delete process.env.WORKER_SECRET;
    expect(() => getProxyConfig()).toThrow("WORKER_SECRET");
  });
  it("returns config when both set", () => {
    process.env.WORKER_URL = "https://w";
    process.env.WORKER_SECRET = "s";
    expect(getProxyConfig()).toEqual({
      workerUrl: "https://w",
      workerSecret: "s",
    });
    delete process.env.WORKER_URL;
    delete process.env.WORKER_SECRET;
  });
});

describe("parseContentPath", () => {
  it("rejects too-short paths", () => {
    expect(parseContentPath(["onlyone"])).toEqual({
      error: "Invalid content path: expected /{sessionKey}/{type}",
    });
  });
  it("rejects unknown type", () => {
    expect(parseContentPath(["sk", "weird"])).toEqual({
      error: 'Invalid content type: weird. Expected "canonical" or "raw"',
    });
  });
  it("builds canonical worker path", () => {
    expect(parseContentPath(["claude:abc", "canonical"])).toEqual({
      workerPath: "/ingest/content/claude:abc/canonical",
    });
  });
  it("builds raw worker path with multi-segment session key", () => {
    expect(parseContentPath(["a", "b", "raw"])).toEqual({
      workerPath: "/ingest/content/a/b/raw",
    });
  });
});

describe("validatePresignRequest", () => {
  it("rejects non-object body", () => {
    expect(validatePresignRequest(null).valid).toBe(false);
    expect(validatePresignRequest("x").valid).toBe(false);
  });
  it("requires sessionKey", () => {
    const r = validatePresignRequest({ rawHash: "abcdef12" });
    expect(r).toEqual({
      valid: false,
      error: expect.stringContaining("sessionKey"),
    });
  });
  it("requires rawHash", () => {
    const r = validatePresignRequest({ sessionKey: "s" });
    expect(r).toEqual({
      valid: false,
      error: expect.stringContaining("rawHash"),
    });
  });
  it("rejects non-hex rawHash", () => {
    const r = validatePresignRequest({ sessionKey: "s", rawHash: "zzzzzzzz" });
    expect(r).toEqual({ valid: false, error: expect.stringContaining("hex") });
  });
  it("accepts valid input", () => {
    expect(
      validatePresignRequest({ sessionKey: "s", rawHash: "deadbeef" }),
    ).toEqual({ valid: true, sessionKey: "s", rawHash: "deadbeef" });
  });
});

describe("buildRawR2Key", () => {
  it("formats key as user/session/raw/hash.json.gz", () => {
    expect(buildRawR2Key("u1", "claude:abc", "ff00")).toBe(
      "u1/claude:abc/raw/ff00.json.gz",
    );
  });
});
