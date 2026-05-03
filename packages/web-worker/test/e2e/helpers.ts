export const BASE_URL = "http://localhost:17022";

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, init);
}

export function assertStatus(res: Response, expected: number): void {
  if (res.status !== expected) {
    throw new Error(
      `Expected status ${expected}, got ${res.status} for ${res.url}`,
    );
  }
}
