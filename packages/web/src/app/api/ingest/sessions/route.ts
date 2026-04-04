import { MAX_METADATA_BODY_BYTES } from "@pika/core";
import { NextResponse } from "next/server";
import { getProxyConfig, type ProxyConfig, proxyToWorker } from "@/lib/ingest";
import { resolveUserForWorker } from "@/lib/worker-proxy";

export async function POST(request: Request) {
  // Validate Content-Length before auth to fail fast on oversized payloads
  const contentLength = parseInt(
    request.headers.get("Content-Length") ?? "",
    10,
  );
  if (!Number.isFinite(contentLength)) {
    return NextResponse.json(
      { error: "Content-Length header is required" },
      { status: 411 },
    );
  }
  if (contentLength > MAX_METADATA_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const userId = await resolveUserForWorker(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let config: ProxyConfig;
  try {
    config = getProxyConfig();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Server configuration error",
      },
      { status: 500 },
    );
  }

  const result = await proxyToWorker(config, {
    method: "POST",
    path: "/ingest/sessions",
    userId,
    body: request.body,
    contentType: request.headers.get("Content-Type") ?? "application/json",
  });

  // 204 No Content must not have a body per HTTP spec
  if (result.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  return new NextResponse(result.body, {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
}
