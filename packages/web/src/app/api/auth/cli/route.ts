import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { handleCliAuth, type CliAuthDb } from "@/lib/cli-auth";

// TODO: Replace with real D1 calls via worker or direct binding
const stubDb: CliAuthDb = {
  async getApiKey(_userId: string) {
    return null; // Always generate new key until DB wired
  },
  async setApiKey(_userId: string, _apiKey: string) {
    // No-op until DB wired
  },
  async getUserByApiKey(_apiKey: string) {
    return null;
  },
};

export async function GET(request: NextRequest) {
  const session = await auth();
  const callback = request.nextUrl.searchParams.get("callback");

  const result = await handleCliAuth(
    {
      callback,
      userEmail: session?.user?.email ?? null,
      userId: session?.user?.id ?? null,
    },
    {
      signInUrl: "/login",
      currentUrl: request.url,
      db: stubDb,
    },
  );

  if (result.error && !result.redirectUrl) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  return NextResponse.redirect(new URL(result.redirectUrl!, request.url));
}
