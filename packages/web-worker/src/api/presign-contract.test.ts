import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../lib/env";
import { createIngestApp } from "./ingest";

afterEach(() => vi.unstubAllGlobals());

function app() {
  const root = new Hono<AppEnv>();
  root.use("*", async (c, next) => {
    c.set("userId", "test-user");
    await next();
  });
  root.route("/", createIngestApp());
  return root;
}

describe("AWS-backed presigning boundary", () => {
  it("creates an offline signature for the owned raw key using explicit test credentials", async () => {
    const network = vi
      .fn()
      .mockRejectedValue(
        new Error("Network forbidden in offline signing test"),
      );
    vi.stubGlobal("fetch", network);
    const response = await app().request(
      "/presign",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionKey: "claude:fixture",
          rawHash: "1234abcd",
        }),
      },
      {
        CF_R2_ACCESS_KEY_ID: "unit-test-access-id",
        CF_R2_SECRET_ACCESS_KEY: "unit-test-secret-not-used-in-production",
        CF_R2_ENDPOINT: "https://storage.example.test",
        CF_R2_BUCKET: "test-bucket",
      } as AppEnv["Bindings"],
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as { key: string; url: string };
    expect(result.key).toBe("test-user/claude:fixture/raw/1234abcd.json.gz");
    const url = new URL(result.url);
    expect(url.hostname).toBe("storage.example.test");
    expect(decodeURIComponent(url.pathname)).toBe(
      "/test-bucket/test-user/claude:fixture/raw/1234abcd.json.gz",
    );
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(network).not.toHaveBeenCalled();
  });

  it("fails closed when the signing environment is absent", async () => {
    const response = await app().request(
      "/presign",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey: "s", rawHash: "1234abcd" }),
      },
      {} as AppEnv["Bindings"],
    );
    expect(response.status).toBe(500);
  });

  it.each([
    null,
    false,
    42,
    { sessionKey: "s" },
    { sessionKey: "s", rawHash: "" },
  ])("rejects an invalid presigning body %j", async (value) => {
    const response = await app().request(
      "/presign",
      { method: "POST", body: JSON.stringify(value) },
      {} as AppEnv["Bindings"],
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
  });
});
