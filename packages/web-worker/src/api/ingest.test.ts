import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../lib/env";
import { createIngestApp, parseContentPath } from "./ingest";

// parseContentPath in api/ingest.ts takes already-split segments.
describe("parseContentPath (api)", () => {
  it("joins segments back into sessionKey", () => {
    const r = parseContentPath(["claude:abc", "canonical"]);
    expect(r).toEqual({ type: "canonical", sessionKey: "claude:abc" });
  });

  it("rejects unknown content type", () => {
    const r = parseContentPath(["k", "bogus"]);
    expect("error" in r).toBe(true);
  });
});

// Regression: CLI URL-encodes the colon (claude%3Asession-id). Without
// decodeURIComponent in the route handler, the worker queries the DB for
// "claude%3Asession-id" and returns 404 even though "claude:session-id"
// exists. Fixed in api/ingest.ts PUT /content/* handler.
describe("PUT /content/* URL decoding", () => {
  it("decodes percent-encoded sessionKey before lookup", async () => {
    const seenKeys: string[] = [];
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("userId", "u1");
      await next();
    });

    // Stub env.DB to capture the bound sessionKey
    const fakeDb = {
      prepare: () => ({
        bind: (_userId: string, sessionKey: string) => {
          seenKeys.push(sessionKey);
          return { first: async () => null };
        },
      }),
    };

    app.route("/api/ingest", createIngestApp());

    const res = await app.request(
      "/api/ingest/content/claude%3Aabc-123/canonical",
      {
        method: "PUT",
        headers: {
          "Content-Length": "10",
          "X-Content-Hash": "deadbeef",
          "X-Parser-Revision": "1",
          "X-Schema-Version": "1",
        },
        body: new Uint8Array(10),
      },
      { DB: fakeDb, BUCKET: {} } as AppEnv["Bindings"],
    );

    expect(res.status).toBe(404);
    expect(seenKeys).toEqual(["claude:abc-123"]);
  });
});
