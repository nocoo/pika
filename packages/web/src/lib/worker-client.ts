/**
 * Worker HTTP client for Next.js to Worker communication.
 *
 * Replaces direct D1 API calls with Worker route calls.
 * Uses WORKER_SECRET + X-User-Id for authentication.
 */

// ── Types ──────────────────────────────────────────────────────

export class WorkerError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WorkerError";
  }
}

export interface WorkerClientConfig {
  workerUrl: string;
  workerSecret: string;
}

// ── Client ─────────────────────────────────────────────────────

export class WorkerClient {
  private readonly workerUrl: string;
  private readonly workerSecret: string;

  constructor(config: WorkerClientConfig) {
    if (!config.workerUrl) throw new Error("workerUrl is required");
    if (!config.workerSecret) throw new Error("workerSecret is required");

    this.workerUrl = config.workerUrl.replace(/\/$/, ""); // Remove trailing slash
    this.workerSecret = config.workerSecret;
  }

  /**
   * Make a GET request to the worker.
   */
  async get<T>(
    path: string,
    userId: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(path, this.workerUrl);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) {
          url.searchParams.set(k, v);
        }
      }
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.workerSecret}`,
        "X-User-Id": userId,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new WorkerError(response.status, text);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return null as unknown as T;
    }

    return response.json();
  }

  /**
   * Make a POST request to the worker.
   */
  async post<T>(path: string, userId: string, body?: unknown): Promise<T> {
    const url = new URL(path, this.workerUrl);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.workerSecret}`,
        "X-User-Id": userId,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new WorkerError(response.status, text);
    }

    if (response.status === 204) {
      return null as unknown as T;
    }

    return response.json();
  }

  /**
   * Make a PATCH request to the worker.
   */
  async patch<T>(path: string, userId: string, body: unknown): Promise<T> {
    const url = new URL(path, this.workerUrl);

    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.workerSecret}`,
        "X-User-Id": userId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new WorkerError(response.status, text);
    }

    if (response.status === 204) {
      return null as unknown as T;
    }

    return response.json();
  }

  /**
   * Make a PUT request to the worker.
   */
  async put<T>(path: string, userId: string, body: unknown): Promise<T> {
    const url = new URL(path, this.workerUrl);

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.workerSecret}`,
        "X-User-Id": userId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new WorkerError(response.status, text);
    }

    if (response.status === 204) {
      return null as unknown as T;
    }

    return response.json();
  }

  /**
   * Make a DELETE request to the worker.
   */
  async delete<T>(path: string, userId: string, body?: unknown): Promise<T> {
    const url = new URL(path, this.workerUrl);

    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.workerSecret}`,
        "X-User-Id": userId,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new WorkerError(response.status, text);
    }

    if (response.status === 204) {
      return null as unknown as T;
    }

    return response.json();
  }

  // ── Convenience methods ────────────────────────────────────────

  /** GET /sessions */
  async listSessions(
    userId: string,
    params?: Record<string, string>,
  ): Promise<unknown> {
    return this.get("/sessions", userId, params);
  }

  /** GET /sessions/:id */
  async getSession(userId: string, sessionId: string): Promise<unknown> {
    return this.get(`/sessions/${encodeURIComponent(sessionId)}`, userId);
  }

  /** GET /sessions/:id/content */
  async getSessionContent(userId: string, sessionId: string): Promise<unknown> {
    return this.get(
      `/sessions/${encodeURIComponent(sessionId)}/content`,
      userId,
    );
  }

  /** GET /sessions/filters */
  async getFilters(userId: string): Promise<unknown> {
    return this.get("/sessions/filters", userId);
  }

  /** GET /projects */
  async listProjects(
    userId: string,
    params?: Record<string, string>,
  ): Promise<unknown> {
    return this.get("/projects", userId, params);
  }

  /** GET /projects/activity */
  async getProjectActivity(
    userId: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    return this.get("/projects/activity", userId, params);
  }

  /** GET /search */
  async search(
    userId: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    return this.get("/search", userId, params);
  }

  /** GET /stats */
  async getStats(userId: string): Promise<unknown> {
    return this.get("/stats", userId);
  }

  /** GET /tags */
  async listTags(userId: string): Promise<unknown> {
    return this.get("/tags", userId);
  }

  /** POST /tags */
  async createTag(
    userId: string,
    body: { name: string; color?: string },
  ): Promise<unknown> {
    return this.post("/tags", userId, body);
  }

  /** PATCH /tags/:id */
  async updateTag(
    userId: string,
    tagId: string,
    body: { name?: string; color?: string | null },
  ): Promise<unknown> {
    return this.patch(`/tags/${encodeURIComponent(tagId)}`, userId, body);
  }

  /** DELETE /tags/:id */
  async deleteTag(userId: string, tagId: string): Promise<void> {
    await this.delete(`/tags/${encodeURIComponent(tagId)}`, userId);
  }

  /** GET /sessions/:id/tags */
  async getSessionTags(userId: string, sessionId: string): Promise<unknown> {
    return this.get(`/sessions/${encodeURIComponent(sessionId)}/tags`, userId);
  }

  /** PUT /sessions/:id/tags */
  async addSessionTag(
    userId: string,
    sessionId: string,
    tagId: string,
  ): Promise<unknown> {
    return this.put(`/sessions/${encodeURIComponent(sessionId)}/tags`, userId, {
      tagId,
    });
  }

  /** DELETE /sessions/:id/tags */
  async removeSessionTag(
    userId: string,
    sessionId: string,
    tagId: string,
  ): Promise<void> {
    await this.delete(
      `/sessions/${encodeURIComponent(sessionId)}/tags`,
      userId,
      { tagId },
    );
  }

  /** PATCH /sessions/:id/star */
  async setSessionStar(
    userId: string,
    sessionId: string,
    starred: boolean,
  ): Promise<unknown> {
    return this.patch(
      `/sessions/${encodeURIComponent(sessionId)}/star`,
      userId,
      { starred },
    );
  }

  /** PATCH /sessions/:id/trash */
  async setSessionTrash(
    userId: string,
    sessionId: string,
    deleted: boolean,
  ): Promise<unknown> {
    return this.patch(
      `/sessions/${encodeURIComponent(sessionId)}/trash`,
      userId,
      { deleted },
    );
  }

  /** POST /sessions/batch */
  async batchOperation(
    userId: string,
    body: {
      action: "delete" | "restore" | "star" | "unstar";
      ids?: string[];
      filter?: Record<string, unknown>;
    },
  ): Promise<unknown> {
    return this.post("/sessions/batch", userId, body);
  }

  /** POST /auth/cli-key */
  async generateCliKey(userId: string): Promise<{ apiKey: string }> {
    return this.post("/auth/cli-key", userId);
  }
}

// ── Singleton ──────────────────────────────────────────────────

let clientInstance: WorkerClient | null = null;

/**
 * Get the singleton WorkerClient instance.
 * Lazily initialized from environment variables.
 */
export function getWorkerClient(): WorkerClient {
  if (!clientInstance) {
    const workerUrl = process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_SECRET;

    if (!workerUrl) {
      throw new Error("WORKER_URL environment variable is not set");
    }
    if (!workerSecret) {
      throw new Error("WORKER_SECRET environment variable is not set");
    }

    clientInstance = new WorkerClient({ workerUrl, workerSecret });
  }
  return clientInstance;
}

/**
 * Reset the singleton instance. Used for testing.
 */
export function resetWorkerClient(): void {
  clientInstance = null;
}
