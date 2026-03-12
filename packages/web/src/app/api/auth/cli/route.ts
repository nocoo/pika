import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { handleCliAuth } from "@/lib/cli-auth";
import { getD1Client } from "@/lib/d1";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db";

export async function GET(request: NextRequest) {
  const session = await auth();
  const callback = request.nextUrl.searchParams.get("callback");
  const db = new D1CliAuthDb(getD1Client());

  const result = await handleCliAuth(
    {
      callback,
      userEmail: session?.user?.email ?? null,
      userId: session?.user?.id ?? null,
    },
    {
      signInUrl: "/login",
      currentUrl: request.url,
      db,
    },
  );

  if (result.error && !result.redirectUrl) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 400 },
    );
  }

  return NextResponse.redirect(new URL(result.redirectUrl!, request.url));
}
