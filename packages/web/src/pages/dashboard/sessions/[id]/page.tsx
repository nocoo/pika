import { useNavigate, useParams } from "react-router";
import useSWR from "swr";
import { SessionReplay } from "@/components/sessions/session-replay";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type ApiError, swrFetcher } from "@/lib/api";
import type { SessionDetailResponse } from "@/lib/session-detail-types";

export function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, error, isLoading } = useSWR<SessionDetailResponse, ApiError>(
    id ? `/api/sessions/${id}` : null,
    swrFetcher,
    { revalidateOnFocus: false },
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6" data-testid="session-detail-loading">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-48 rounded-xl" />
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

  if (error) {
    const msg = error.status === 404 ? "Session not found" : error.message;
    return (
      <div
        className="flex flex-col items-center gap-4 py-20"
        data-testid="session-detail-error"
      >
        <div className="text-sm text-destructive">{msg}</div>
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
          Go back
        </Button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex flex-col gap-4" data-testid="session-detail">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => navigate(-1)}
          data-testid="back-button"
        >
          <svg
            className="size-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            aria-hidden="true"
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
        contentUrl={
          data.session.content_key ? `/api/sessions/${id}/content` : null
        }
      />
    </div>
  );
}
