import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { handleCliAuth, getPublicOrigin } from "@/lib/cli-auth";
import { getD1Client } from "@/lib/d1";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db";

export async function GET(request: NextRequest) {
  const session = await auth();
  const url = new URL(request.url);
  const callback = url.searchParams.get("callback");
  const db = new D1CliAuthDb(getD1Client());

  const result = await handleCliAuth(
    {
      callback,
      userEmail: session?.user?.email ?? null,
      userId: session?.user?.id ?? null,
    },
    {
      signInUrl: "/login",
      returnPath: url.pathname + url.search,
      db,
    },
  );

  if (result.error && !result.redirectUrl) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400 },
    );
  }

  const origin = getPublicOrigin(request);
  return NextResponse.redirect(new URL(result.redirectUrl!, origin));
}
