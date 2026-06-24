import { describe, expect, it } from "vitest";
import { apiFetch } from "./helpers";

describe("POST /api/ingest/sessions", () => {
  it("accepts a minimal payload and persists it", async () => {
    const now = new Date().toISOString();
    const sessionKey = "claude-code:e2e-session-001";
    const title = "E2E Test Session";
    const payload = {
      sessions: [
        {
          sessionKey,
          source: "claude-code",
          startedAt: now,
          lastMessageAt: now,
          durationSeconds: 5,
          snapshotAt: now,
          userMessages: 1,
          assistantMessages: 1,
          totalMessages: 2,
          totalInputTokens: 50,
          totalOutputTokens: 50,
          totalCachedTokens: 0,
          projectRef: null,
          projectName: null,
          model: null,
          title,
          contentHash: "e2e0000000000001",
          rawHash: "e2e0000000000002",
          parserRevision: 1,
          schemaVersion: 1,
        },
      ],
    };

    const body = JSON.stringify(payload);
    const res = await apiFetch("/api/ingest/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(body.length),
      },
      body,
    });

    const resBody = await res.json();
    expect({ status: res.status, body: resBody }).toMatchObject({
      status: 200,
      body: { ingested: 1 },
    });

    // Round-trip: confirm the session is actually queryable, not just
    // that the upsert returned 200. A silent D1 write failure would
    // still pass the ingested-count assertion above.
    const listRes = await apiFetch("/api/sessions?limit=100");
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as {
      sessions: Array<{ session_key: string; title: string | null }>;
    };
    const found = list.sessions.find((s) => s.session_key === sessionKey);
    expect(found, `expected ${sessionKey} in session list`).toBeDefined();
    expect(found?.title).toBe(title);
  });
});
