import { describe, expect, it, vi } from "vitest";
import { type Env, handleCanonicalUpload, handleContentRead } from "./ingest";

const content = '{"messages":[{"role":"user","content":"synthetic fixture"}]}';

describe("raw content ownership and compression", () => {
  it.each(["X-Parser-Revision", "X-Schema-Version"])(
    "rejects a missing %s before any storage access",
    async (header) => {
      const headers = new Headers({
        "X-Content-Hash": "1234abcd",
        "X-Parser-Revision": "1",
        "X-Schema-Version": "1",
      });
      headers.delete(header);
      const prepare = vi.fn();
      const response = await handleCanonicalUpload(
        "s",
        "user",
        new Request("https://unit.example.test/content", {
          method: "PUT",
          headers,
        }),
        { DB: { prepare } } as unknown as Env,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: `Invalid ${header} header`,
      });
      expect(prepare).not.toHaveBeenCalled();
    },
  );

  it("rejects another user before touching storage", async () => {
    const get = vi.fn();
    const response = await handleContentRead("other/s/raw", "user", {
      BUCKET: { get },
    } as unknown as Env);
    expect(response.status).toBe(403);
    expect(get).not.toHaveBeenCalled();
  });

  it("returns not found for an absent owned object", async () => {
    const get = vi.fn().mockResolvedValue(null);
    const response = await handleContentRead("user/s/raw", "user", {
      BUCKET: { get },
    } as unknown as Env);
    expect(response.status).toBe(404);
    expect(get).toHaveBeenCalledWith("user/s/raw");
  });

  it.each([
    ["user/s/raw.json", undefined, false],
    ["user/s/raw.json.gz", {}, true],
    ["user/s/raw", { contentEncoding: "gzip" }, true],
  ])(
    "reads %s with optional encoding metadata",
    async (key, httpMetadata, compressed) => {
      const plain = new Blob([content]).stream();
      const body = compressed
        ? plain.pipeThrough(new CompressionStream("gzip"))
        : plain;
      const get = vi.fn().mockResolvedValue({ body, httpMetadata });
      const response = await handleContentRead(key, "user", {
        BUCKET: { get },
      } as unknown as Env);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");
      expect(response.headers.get("Cache-Control")).toBe(
        "private, max-age=300",
      );
      expect(await response.text()).toBe(content);
    },
  );
});
