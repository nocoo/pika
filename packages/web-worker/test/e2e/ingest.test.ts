import { describe, expect, it } from "vitest";
import { apiFetch } from "./helpers";

describe("POST /api/ingest/sessions", () => {
  it("accepts a minimal payload and returns 200", async () => {
    const now = new Date().toISOString();
    const payload = {
      sessions: [
        {
          sessionKey: "claude-code:e2e-session-001",
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
          title: "E2E Test Session",
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
  });
});
