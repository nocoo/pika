import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { handleCliAuth } from "@/lib/cli-auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  const callback = request.nextUrl.searchParams.get("callback");

  const result = handleCliAuth(
    {
      callback,
      userEmail: session?.user?.email ?? null,
      userId: session?.user?.id ?? null,
    },
    {
      signInUrl: "/login",
      currentUrl: request.url,
    },
  );

  return NextResponse.redirect(new URL(result.redirectUrl, request.url));
}
