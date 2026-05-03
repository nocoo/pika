import { describe, expect, it } from "vitest";
import { apiFetch } from "./helpers";

describe("POST /api/ingest/sessions", () => {
  it("accepts a minimal payload and returns 200", async () => {
    const payload = {
      sessions: [
        {
          session_key: "e2e-test:session-001",
          source: "claude",
          title: "E2E Test Session",
          started_at: new Date().toISOString(),
          snapshot_at: new Date().toISOString(),
          message_count: 2,
          turn_count: 1,
          token_count: 100,
          cost_usd: 0.01,
          duration_ms: 5000,
          cwd: "/tmp/test",
          content_hash: "e2e0000000000000",
          parser_revision: 1,
          schema_version: 1,
        },
      ],
    };

    const res = await apiFetch("/api/ingest/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(JSON.stringify(payload).length),
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("upserted");
  });
});
