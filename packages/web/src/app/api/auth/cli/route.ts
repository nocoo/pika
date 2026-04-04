import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPublicOrigin, handleCliAuth } from "@/lib/cli-auth";
import {
  generateCliKeyViaWorker,
  WorkerCliAuthDb,
} from "@/lib/worker-cli-auth-db";

export async function GET(request: NextRequest) {
  const session = await auth();
  const url = new URL(request.url);
  const callback = url.searchParams.get("callback");

  // For authenticated users, pre-generate the key via Worker
  // before calling handleCliAuth. This way the Worker handles
  // both generation and storage atomically.
  let db: WorkerCliAuthDb;
  let preGeneratedKey: string | undefined;

  if (session?.user?.id) {
    try {
      const generated = await generateCliKeyViaWorker(session.user.id);
      db = generated.db;
      preGeneratedKey = generated.apiKey;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } else {
    // Not authenticated yet - create a dummy db (won't be used)
    db = new WorkerCliAuthDb();
  }

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
      // Pass the pre-generated key so handleCliAuth uses it instead of
      // generating a new one. The Worker already stored the hash.
      generateKey: preGeneratedKey ? () => preGeneratedKey : undefined,
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
