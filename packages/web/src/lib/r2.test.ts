import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { R2Client, getR2Client, resetR2Client } from "./r2.js";

// ── Mock AWS SDK ───────────────────────────────────────────────

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockImplementation(
    async (_client, command, opts) =>
      `https://r2.example.com/${command.input.Key}?expires=${opts?.expiresIn ?? 3600}`,
  ),
}));

const cfg = {
  accessKeyId: "ak-1",
  secretAccessKey: "sk-1",
  endpoint: "https://r2.example.com",
  bucket: "pika-sessions",
};

beforeEach(() => {
  resetR2Client();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Constructor ────────────────────────────────────────────────

describe("R2Client constructor", () => {
  it("throws when accessKeyId is empty", () => {
    expect(() => new R2Client({ ...cfg, accessKeyId: "" })).toThrow(
      "accessKeyId is required",
    );
  });

  it("throws when secretAccessKey is empty", () => {
    expect(() => new R2Client({ ...cfg, secretAccessKey: "" })).toThrow(
      "secretAccessKey is required",
    );
  });

  it("throws when endpoint is empty", () => {
    expect(() => new R2Client({ ...cfg, endpoint: "" })).toThrow(
      "endpoint is required",
    );
  });

  it("throws when bucket is empty", () => {
    expect(() => new R2Client({ ...cfg, bucket: "" })).toThrow(
      "bucket is required",
    );
  });

  it("creates S3Client with correct config", async () => {
    const { S3Client } = await import("@aws-sdk/client-s3");
    new R2Client(cfg);

    expect(S3Client).toHaveBeenCalledWith({
      region: "auto",
      endpoint: "https://r2.example.com",
      credentials: {
        accessKeyId: "ak-1",
        secretAccessKey: "sk-1",
      },
    });
  });
});

// ── getPresignedUrl() ──────────────────────────────────────────

describe("R2Client.getPresignedUrl", () => {
  it("returns presigned URL for given key", async () => {
    const client = new R2Client(cfg);

    const url = await client.getPresignedUrl("some/key.json.gz");

    expect(url).toBe(
      "https://r2.example.com/some/key.json.gz?expires=3600",
    );
  });

  it("uses custom expiresIn", async () => {
    const client = new R2Client(cfg);

    const url = await client.getPresignedUrl("key.gz", 600);

    expect(url).toContain("expires=600");
  });

  it("passes correct Bucket and Key to GetObjectCommand", async () => {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new R2Client(cfg);

    await client.getPresignedUrl("my/obj.gz");

    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: "pika-sessions",
      Key: "my/obj.gz",
    });
  });
});

// ── getCanonicalUrl() ──────────────────────────────────────────

describe("R2Client.getCanonicalUrl", () => {
  it("generates correct key pattern", async () => {
    const client = new R2Client(cfg);

    const url = await client.getCanonicalUrl("user-1", "claude:abc123");

    expect(url).toBe(
      "https://r2.example.com/user-1/claude:abc123/canonical.json.gz?expires=3600",
    );
  });

  it("uses custom expiresIn", async () => {
    const client = new R2Client(cfg);

    const url = await client.getCanonicalUrl("u1", "key", 120);

    expect(url).toContain("expires=120");
  });
});

// ── getRawUrl() ────────────────────────────────────────────────

describe("R2Client.getRawUrl", () => {
  it("generates correct key pattern with rawHash", async () => {
    const client = new R2Client(cfg);

    const url = await client.getRawUrl("user-1", "claude:abc", "deadbeef");

    expect(url).toBe(
      "https://r2.example.com/user-1/claude:abc/raw/deadbeef.json.gz?expires=3600",
    );
  });

  it("uses custom expiresIn", async () => {
    const client = new R2Client(cfg);

    const url = await client.getRawUrl("u", "k", "h", 900);

    expect(url).toContain("expires=900");
  });
});

// ── Singleton factory ──────────────────────────────────────────

// ── putPresignedUrl() ──────────────────────────────────────────

describe("R2Client.putPresignedUrl", () => {
  it("returns presigned PUT URL for given key", async () => {
    const client = new R2Client(cfg);

    const url = await client.putPresignedUrl("some/key.json.gz");

    expect(url).toBe(
      "https://r2.example.com/some/key.json.gz?expires=3600",
    );
  });

  it("uses custom expiresIn", async () => {
    const client = new R2Client(cfg);

    const url = await client.putPresignedUrl("key.gz", "application/gzip", 300);

    expect(url).toContain("expires=300");
  });

  it("passes correct Bucket, Key, and ContentType to PutObjectCommand", async () => {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new R2Client(cfg);

    await client.putPresignedUrl("my/obj.gz", "application/gzip");

    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: "pika-sessions",
      Key: "my/obj.gz",
      ContentType: "application/gzip",
    });
  });
});

// ── putRawUrl() ────────────────────────────────────────────────

describe("R2Client.putRawUrl", () => {
  it("generates correct key pattern with rawHash", async () => {
    const client = new R2Client(cfg);

    const url = await client.putRawUrl("user-1", "claude:abc", "deadbeef");

    expect(url).toBe(
      "https://r2.example.com/user-1/claude:abc/raw/deadbeef.json.gz?expires=3600",
    );
  });

  it("uses custom expiresIn", async () => {
    const client = new R2Client(cfg);

    const url = await client.putRawUrl("u", "k", "h", 600);

    expect(url).toContain("expires=600");
  });
});

// ── Singleton factory ──────────────────────────────────────────

describe("getR2Client", () => {
  it("returns same instance on repeated calls", () => {
    process.env.CF_R2_ACCESS_KEY_ID = "a";
    process.env.CF_R2_SECRET_ACCESS_KEY = "s";
    process.env.CF_R2_ENDPOINT = "https://e.com";
    process.env.CF_R2_BUCKET = "b";

    const a = getR2Client();
    const b = getR2Client();

    expect(a).toBe(b);

    delete process.env.CF_R2_ACCESS_KEY_ID;
    delete process.env.CF_R2_SECRET_ACCESS_KEY;
    delete process.env.CF_R2_ENDPOINT;
    delete process.env.CF_R2_BUCKET;
  });

  it("creates new instance after resetR2Client", () => {
    process.env.CF_R2_ACCESS_KEY_ID = "a";
    process.env.CF_R2_SECRET_ACCESS_KEY = "s";
    process.env.CF_R2_ENDPOINT = "https://e.com";
    process.env.CF_R2_BUCKET = "b";

    const a = getR2Client();
    resetR2Client();
    const b = getR2Client();

    expect(a).not.toBe(b);

    delete process.env.CF_R2_ACCESS_KEY_ID;
    delete process.env.CF_R2_SECRET_ACCESS_KEY;
    delete process.env.CF_R2_ENDPOINT;
    delete process.env.CF_R2_BUCKET;
  });
});
