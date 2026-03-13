"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { SessionReplay } from "@/components/sessions/session-replay";
import type { SessionDetailResponse } from "@/lib/session-detail";

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<SessionDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(`/api/sessions/${id}`);
        if (res.status === 404) {
          setError("Session not found");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: SessionDetailResponse = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load session",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  // ── Loading state ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        {/* Back button skeleton */}
        <Skeleton className="h-8 w-20 rounded-md" />
        {/* Header card skeleton */}
        <Skeleton className="h-48 rounded-xl" />
        {/* Message skeletons */}
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="size-7 rounded-full shrink-0" />
              <Skeleton className="h-16 w-2/3 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <div className="text-sm text-destructive">{error}</div>
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          Go back
        </Button>
      </div>
    );
  }

  // ── Data loaded ────────────────────────────────────────────

  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Back navigation */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => router.back()}
        >
          <svg
            className="size-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
            />
          </svg>
          Back
        </Button>
      </div>

      <SessionReplay
        session={data.session}
        contentUrl={data.contentUrl}
      />
    </div>
  );
}
