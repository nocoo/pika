import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR } from "@pika/core";
import { ConfigManager } from "../config/manager.js";

// ─── Types ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken: () => string | undefined;
  fetchFn?: typeof fetch;
  retry?: {
    maxAttempts?: number;
    backoffMs?: number;
    retryOn?: number[];
  };
}

// ─── ApiClient ────────────────────────────────────────────────

const DEFAULT_RETRY = {
  maxAttempts: 3,
  backoffMs: 1000,
  retryOn: [429, 502, 503, 504],
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly retry: Required<NonNullable<ApiClientOptions["retry"]>>;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.getToken = options.getToken;
    this.fetchFn = options.fetchFn ?? fetch;
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  async get<T>(
    path: string,
    params?: Record<string, string>
  ): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path, params);
    return this.requestWithRetry<T>("GET", url);
  }

  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path);
    return this.requestWithRetry<T>("POST", url, body);
  }

  async put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path);
    return this.requestWithRetry<T>("PUT", url, body);
  }

  async patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path);
    return this.requestWithRetry<T>("PATCH", url, body);
  }

  async delete<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path);
    return this.requestWithRetry<T>("DELETE", url, body);
  }

  private buildUrl(path: string, params?: Record<string, string>): string {
    // Ensure baseUrl ends with / for proper path joining
    // e.g., "https://host/api" + "/sessions" → "https://host/api/sessions"
    const base = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    const url = new URL(cleanPath, base);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") {
          url.searchParams.set(key, value);
        }
      }
    }
    return url.toString();
  }

  private async requestWithRetry<T>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    let lastError: ApiResponse<T> | undefined;

    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt++) {
      const response = await this.request<T>(method, url, body);

      if (response.ok) {
        return response;
      }

      // Don't retry client errors (4xx) except rate limits
      if (
        response.status >= 400 &&
        response.status < 500 &&
        !this.retry.retryOn.includes(response.status)
      ) {
        return response;
      }

      // Retry on configured status codes
      if (this.retry.retryOn.includes(response.status)) {
        lastError = response;
        if (attempt < this.retry.maxAttempts) {
          const delay = this.retry.backoffMs * 2 ** (attempt - 1);
          await this.sleep(delay);
          continue;
        }
      }

      return response;
    }

    return lastError!;
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {};

    const token = this.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    try {
      const response = await this.fetchFn(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (response.status === 204) {
        return { ok: true, status: 204 };
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        const text = await response.text();
        return {
          ok: response.ok,
          status: response.status,
          error: response.ok ? undefined : text || response.statusText,
        };
      }

      const data = await response.json();

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: data.error ?? data.message ?? response.statusText,
        };
      }

      return {
        ok: true,
        status: response.status,
        data: data as T,
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        error: err instanceof Error ? err.message : "Network error",
      };
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─── Pika-specific factory ────────────────────────────────────

export const PIKA_PAGINATION = {
  defaultLimit: 50,
  maxLimit: 100,
} as const;

let cachedClient: ApiClient | undefined;
let cachedConfig: ConfigManager | undefined;

/* v8 ignore start */
export function createPikaClient(isDev = false): ApiClient {
  if (cachedClient && cachedConfig?.getApiUrl()) {
    return cachedClient;
  }

  const configDir = join(homedir(), ".config", CONFIG_DIR);
  const config = new ConfigManager(configDir, isDev);
  cachedConfig = config;

  cachedClient = new ApiClient({
    baseUrl: `${config.getApiUrl()}/api`,
    getToken: () => config.getToken(),
  });

  return cachedClient;
}

/** Reset cached client (for testing) */
export function resetPikaClient(): void {
  cachedClient = undefined;
  cachedConfig = undefined;
}
/* v8 ignore stop */
