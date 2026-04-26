/**
 * SPA-side API client. Talks to `/api/*` (proxied by Vite dev → web-worker:7025
 * in dev; same-origin in prod since web-worker also serves the static SPA).
 *
 * `credentials: "include"` keeps the CF Access cookie on every request.
 * On 401 we trigger a full reload so CF Access can hand us a fresh JWT —
 * no client-side login UI exists.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiFetchInit extends RequestInit {
  /** Skip the 401-triggers-reload behaviour. Used by hooks that
   *  intentionally probe an unauthenticated state (e.g. boot-time useMe). */
  skipAuthReload?: boolean;
}

export async function apiFetch(
  path: string,
  init: ApiFetchInit = {},
): Promise<Response> {
  if (!path.startsWith("/")) {
    throw new Error(`apiFetch: path must start with "/" (got: ${path})`);
  }
  const { skipAuthReload, ...rest } = init;
  const res = await fetch(path, {
    credentials: "include",
    ...rest,
  });
  if (res.status === 401 && !skipAuthReload) {
    // CF Access will intercept the next navigation and start its own flow.
    if (typeof window !== "undefined") window.location.reload();
  }
  return res;
}

/** GET/POST JSON. Throws `ApiError` for non-2xx. */
export async function apiJson<T = unknown>(
  path: string,
  init: ApiFetchInit = {},
): Promise<T> {
  const res = await apiFetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body !== undefined && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  let body: unknown;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

/** SWR-compatible fetcher: `useSWR(path, swrFetcher)`. */
export function swrFetcher<T = unknown>(path: string): Promise<T> {
  return apiJson<T>(path);
}
