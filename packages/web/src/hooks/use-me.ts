import useSWR from "swr";
import { type ApiError, swrFetcher } from "@/lib/api";

export interface MeResponse {
  email: string | null;
  userId: string | null;
}

/** Loads the authenticated identity from `/api/me`. */
export function useMe() {
  const { data, error, isLoading, mutate } = useSWR<MeResponse, ApiError>(
    "/api/me",
    swrFetcher,
    {
      // identity rarely changes; revalidate on focus is enough
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );
  return {
    me: data ?? null,
    error: error ?? null,
    isLoading,
    isAuthenticated: !!data?.userId,
    refresh: mutate,
  };
}
