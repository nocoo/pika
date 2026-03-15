import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/cli-auth";
import { D1CliAuthDb } from "@/lib/d1-cli-auth-db";
import { getD1Client } from "@/lib/d1";
import { auth } from "@/lib/auth";
import { buildFilterOptionsQuery } from "@/lib/sessions";

interface ModelRow {
  model: string;
}

interface ProjectRow {
  project_ref: string;
  project_name: string | null;
}

export async function GET(request: Request) {
  const d1 = getD1Client();
  const db = new D1CliAuthDb(d1);

  const user = await resolveUser(request, {
    getSession: async () => {
      const session = await auth();
      if (!session?.user?.id) return null;
      return { userId: session.user.id, email: session.user.email ?? undefined };
    },
    db,
  });

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { modelsSql, modelsParams, projectsSql, projectsParams } =
    buildFilterOptionsQuery(user.userId);

  const [modelsResult, projectsResult] = await Promise.all([
    d1.query<ModelRow>(modelsSql, modelsParams),
    d1.query<ProjectRow>(projectsSql, projectsParams),
  ]);

  return NextResponse.json({
    models: modelsResult.results.map((r) => r.model),
    projects: projectsResult.results.map((r) => ({
      ref: r.project_ref,
      name: r.project_name,
    })),
  });
}
