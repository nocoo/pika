import { MAX_CONTENT_UPLOAD_BYTES } from "@pika/core";
import { NextResponse } from "next/server";
import {
  getProxyConfig,
  type ProxyConfig,
  parseContentPath,
  proxyToWorker,
} from "@/lib/ingest";
import { resolveUserForWorker } from "@/lib/worker-proxy";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
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
  if (contentLength > MAX_CONTENT_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const userId = await resolveUserForWorker(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { path } = await params;
  const parsed = parseContentPath(path);

  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
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

  // Collect custom ingest headers to forward to the Worker
  const extraHeaders: Record<string, string> = {};
  const forwardHeaders = [
    "X-Content-Hash",
    "X-Parser-Revision",
    "X-Schema-Version",
    "X-Raw-Hash",
    "Content-Encoding",
  ];
  for (const name of forwardHeaders) {
    const value = request.headers.get(name);
    if (value) extraHeaders[name] = value;
  }

  const result = await proxyToWorker(config, {
    method: "PUT",
    path: parsed.workerPath,
    userId,
    body: request.body,
    contentType:
      request.headers.get("Content-Type") ?? "application/octet-stream",
    extraHeaders,
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
