import type { Source } from "@pika/core";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveUser } from "@/lib/cli-auth";
import { getD1Client } from "@/lib/d1";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db";
import {
  type BatchAction,
  buildBatchByFilterQuery,
  buildBatchByIdsQuery,
  type SessionListParams,
} from "@/lib/sessions";

async function authenticate(request: Request) {
  const d1 = getD1Client();
  const db = new D1CliAuthDb(d1);

  const user = await resolveUser(request, {
    getSession: async () => {
      const session = await auth();
      if (!session?.user?.id) return null;
      return {
        userId: session.user.id,
        email: session.user.email ?? undefined,
      };
    },
    db,
  });

  return { user, d1 };
}

const VALID_ACTIONS = new Set<BatchAction>([
  "delete",
  "restore",
  "star",
  "unstar",
]);
const MAX_IDS = 100;
const CHUNK_SIZE = 50;

const VALID_SOURCES = new Set([
  "claude-code",
  "codex",
  "gemini-cli",
  "opencode",
  "vscode-copilot",
]);

interface BatchRequestBody {
  action: BatchAction;
  ids?: string[];
  filter?: {
    source?: string;
    model?: string;
    starred?: boolean;
    minMessages?: number;
    maxMessages?: number;
    deleted?: boolean;
  };
}

/** POST /api/sessions/batch — batch operations on sessions */
export async function POST(request: Request) {
  const { user, d1 } = await authenticate(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: BatchRequestBody;
  try {
    body = (await request.json()) as BatchRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate action
  if (!body.action || !VALID_ACTIONS.has(body.action)) {
    return NextResponse.json(
      {
        error: `Invalid action. Must be one of: ${[...VALID_ACTIONS].join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Must have either ids or filter, not both
  const hasIds = Array.isArray(body.ids) && body.ids.length > 0;
  const hasFilter = body.filter != null && typeof body.filter === "object";

  if (hasIds && hasFilter) {
    return NextResponse.json(
      { error: "Provide either ids or filter, not both" },
      { status: 400 },
    );
  }

  if (!hasIds && !hasFilter) {
    return NextResponse.json(
      { error: "Provide either ids or filter" },
      { status: 400 },
    );
  }

  let totalAffected = 0;

  if (hasIds) {
    const ids = body.ids!;

    // Validate IDs
    if (ids.length > MAX_IDS) {
      return NextResponse.json(
        { error: `Too many IDs. Maximum is ${MAX_IDS}` },
        { status: 400 },
      );
    }

    if (!ids.every((id) => typeof id === "string" && id.length > 0)) {
      return NextResponse.json(
        { error: "All IDs must be non-empty strings" },
        { status: 400 },
      );
    }

    // Chunk into batches of CHUNK_SIZE for D1 parameter limits
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const query = buildBatchByIdsQuery({
        action: body.action,
        ids: chunk,
        userId: user.userId,
      });
      const meta = await d1.execute(query.sql, query.params);
      totalAffected += meta.changes;
    }
  } else {
    // Filter mode
    const f = body.filter!;
    const filterParams: SessionListParams = {
      userId: user.userId,
      source:
        f.source && VALID_SOURCES.has(f.source)
          ? (f.source as Source)
          : undefined,
      model: f.model || undefined,
      starred: f.starred === true ? true : undefined,
      minMessages: f.minMessages,
      maxMessages: f.maxMessages,
      deleted: f.deleted === true ? true : undefined,
    };

    const query = buildBatchByFilterQuery({
      action: body.action,
      filter: filterParams,
    });
    const meta = await d1.execute(query.sql, query.params);
    totalAffected = meta.changes;
  }

  return NextResponse.json({ affected: totalAffected });
}
