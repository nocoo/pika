/**
 * Worker HTTP client for Next.js → Worker communication.
 *
 * Runtime-agnostic: caller supplies WorkerClientConfig. The web layer
 * adds a singleton factory that pulls config from process.env.
 */

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

export class WorkerClient {
  private readonly workerUrl: string;
  private readonly workerSecret: string;

  constructor(config: WorkerClientConfig) {
    if (!config.workerUrl) throw new Error("workerUrl is required");
    if (!config.workerSecret) throw new Error("workerSecret is required");

    this.workerUrl = config.workerUrl.replace(/\/$/, "");
    this.workerSecret = config.workerSecret;
  }

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

    if (response.status === 204) {
      return null as unknown as T;
    }

    return response.json();
  }

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

  async listSessions(
    userId: string,
    params?: Record<string, string>,
  ): Promise<unknown> {
    return this.get("/sessions", userId, params);
  }

  async getSession(userId: string, sessionId: string): Promise<unknown> {
    return this.get(`/sessions/${encodeURIComponent(sessionId)}`, userId);
  }

  async getSessionContent(userId: string, sessionId: string): Promise<unknown> {
    return this.get(
      `/sessions/${encodeURIComponent(sessionId)}/content`,
      userId,
    );
  }

  async getFilters(userId: string): Promise<unknown> {
    return this.get("/sessions/filters", userId);
  }

  async listProjects(
    userId: string,
    params?: Record<string, string>,
  ): Promise<unknown> {
    return this.get("/projects", userId, params);
  }

  async getProjectActivity(
    userId: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    return this.get("/projects/activity", userId, params);
  }

  async search(
    userId: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    return this.get("/search", userId, params);
  }

  async getStats(userId: string): Promise<unknown> {
    return this.get("/stats", userId);
  }

  async listTags(userId: string): Promise<unknown> {
    return this.get("/tags", userId);
  }

  async createTag(
    userId: string,
    body: { name: string; color?: string },
  ): Promise<unknown> {
    return this.post("/tags", userId, body);
  }

  async updateTag(
    userId: string,
    tagId: string,
    body: { name?: string; color?: string | null },
  ): Promise<unknown> {
    return this.patch(`/tags/${encodeURIComponent(tagId)}`, userId, body);
  }

  async deleteTag(userId: string, tagId: string): Promise<void> {
    await this.delete(`/tags/${encodeURIComponent(tagId)}`, userId);
  }

  async getSessionTags(userId: string, sessionId: string): Promise<unknown> {
    return this.get(`/sessions/${encodeURIComponent(sessionId)}/tags`, userId);
  }

  async addSessionTag(
    userId: string,
    sessionId: string,
    tagId: string,
  ): Promise<unknown> {
    return this.put(`/sessions/${encodeURIComponent(sessionId)}/tags`, userId, {
      tagId,
    });
  }

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

  async generateCliKey(userId: string): Promise<{ apiKey: string }> {
    return this.post("/auth/cli-key", userId);
  }
}
