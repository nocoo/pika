import type { ReactNode } from "react";
import { useMe } from "@/hooks/use-me";

interface RequireAuthProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Gates a subtree on `useMe()`. While loading we show a fallback; on auth
 * miss CF Access takes over via `apiFetch`'s 401-triggers-reload path, so
 * here we only need to render a quiet placeholder.
 */
export function RequireAuth({ children, fallback }: RequireAuthProps) {
  const { isLoading, isAuthenticated } = useMe();
  if (isLoading) {
    return (
      fallback ?? (
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
          Loading…
        </div>
      )
    );
  }
  if (!isAuthenticated) {
    return (
      fallback ?? (
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
          Redirecting to sign in…
        </div>
      )
    );
  }
  return <>{children}</>;
}
