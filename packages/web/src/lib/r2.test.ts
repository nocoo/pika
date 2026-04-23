import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertTestBucket,
  getR2Client,
  resetR2Client,
  TEST_BUCKET_NAME,
} from "./r2";

vi.mock("@aws-sdk/client-s3", () => {
  const sendFn = vi.fn();
  return {
    S3Client: vi.fn().mockImplementation(() => ({ send: sendFn })),
    GetObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
    PutObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
    HeadObjectCommand: vi
      .fn()
      .mockImplementation((input) => ({ _type: "HeadObject", input })),
    __mockSend: sendFn,
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(),
}));

beforeEach(() => {
  resetR2Client();
});

afterEach(() => {
  vi.clearAllMocks();
});

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

describe("assertTestBucket (web wrapper)", () => {
  let savedBucket: string | undefined;

  beforeEach(() => {
    savedBucket = process.env.CF_R2_BUCKET;
  });

  afterEach(() => {
    if (savedBucket !== undefined) {
      process.env.CF_R2_BUCKET = savedBucket;
    } else {
      delete process.env.CF_R2_BUCKET;
    }
  });

  it("passes when bucket matches test bucket", () => {
    process.env.CF_R2_BUCKET = TEST_BUCKET_NAME;
    expect(() => assertTestBucket()).not.toThrow();
  });

  it("throws when bucket does not match", () => {
    process.env.CF_R2_BUCKET = "pika-production";
    expect(() => assertTestBucket()).toThrow("R2 isolation FAILED");
  });

  it("throws when bucket is undefined", () => {
    delete process.env.CF_R2_BUCKET;
    expect(() => assertTestBucket()).toThrow("R2 isolation FAILED");
  });
});
