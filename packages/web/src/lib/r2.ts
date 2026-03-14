/**
 * Cloudflare R2 client for the web dashboard.
 *
 * Generates presigned GET URLs so the browser (or server component)
 * can download canonical/raw session content directly from R2.
 *
 * Uses S3-compatible SDK since R2 exposes an S3 API.
 */

import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ── Types ──────────────────────────────────────────────────────

export interface R2Config {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucket: string;
}

// ── Client ─────────────────────────────────────────────────────

/** Default presigned URL TTL: 1 hour. */
const DEFAULT_EXPIRES_IN = 3600;

export class R2Client {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(config: R2Config) {
    if (!config.accessKeyId) throw new Error("accessKeyId is required");
    if (!config.secretAccessKey) throw new Error("secretAccessKey is required");
    if (!config.endpoint) throw new Error("endpoint is required");
    if (!config.bucket) throw new Error("bucket is required");

    this.bucket = config.bucket;
    this.s3 = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  /**
   * Generate a presigned GET URL for an R2 object.
   * @param key - Full R2 object key
   * @param expiresIn - URL TTL in seconds (default 3600)
   */
  async getPresignedUrl(
    key: string,
    expiresIn = DEFAULT_EXPIRES_IN,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  /**
   * Presigned URL for canonical session content.
   * Key pattern: `{userId}/{sessionKey}/canonical.json.gz`
   */
  async getCanonicalUrl(
    userId: string,
    sessionKey: string,
    expiresIn = DEFAULT_EXPIRES_IN,
  ): Promise<string> {
    return this.getPresignedUrl(
      `${userId}/${sessionKey}/canonical.json.gz`,
      expiresIn,
    );
  }

  /**
   * Presigned URL for raw session archive.
   * Key pattern: `{userId}/{sessionKey}/raw/{rawHash}.json.gz`
   */
  async getRawUrl(
    userId: string,
    sessionKey: string,
    rawHash: string,
    expiresIn = DEFAULT_EXPIRES_IN,
  ): Promise<string> {
    return this.getPresignedUrl(
      `${userId}/${sessionKey}/raw/${rawHash}.json.gz`,
      expiresIn,
    );
  }

  // ── Presigned PUT URLs ────────────────────────────────────────

  /**
   * Generate a presigned PUT URL for uploading to R2.
   * @param key - Full R2 object key
   * @param contentType - MIME type for the upload
   * @param expiresIn - URL TTL in seconds (default 3600)
   */
  async putPresignedUrl(
    key: string,
    contentType = "application/octet-stream",
    expiresIn = DEFAULT_EXPIRES_IN,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  /**
   * Presigned PUT URL for raw session archive direct upload.
   * Key pattern: `{userId}/{sessionKey}/raw/{rawHash}.json.gz`
   */
  async putRawUrl(
    userId: string,
    sessionKey: string,
    rawHash: string,
    expiresIn = DEFAULT_EXPIRES_IN,
  ): Promise<string> {
    return this.putPresignedUrl(
      `${userId}/${sessionKey}/raw/${rawHash}.json.gz`,
      "application/gzip",
      expiresIn,
    );
  }

  // ── HEAD check ──────────────────────────────────────────────────

  /**
   * Check if an R2 object exists.
   * @param key - Full R2 object key
   * @returns true if the object exists, false otherwise
   */
  async headObject(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
      return true;
    } catch (err: unknown) {
      const code = (err as { name?: string }).name;
      if (code === "NotFound" || code === "NoSuchKey") {
        return false;
      }
      throw err;
    }
  }
}

// ── Singleton factory ──────────────────────────────────────────

let _client: R2Client | null = null;

/**
 * Get or create the R2 client singleton.
 * Reads config from environment variables.
 */
export function getR2Client(): R2Client {
  if (!_client) {
    _client = new R2Client({
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY ?? "",
      endpoint: process.env.CF_R2_ENDPOINT ?? "",
      bucket: process.env.CF_R2_BUCKET ?? "",
    });
  }
  return _client;
}

/** Reset singleton (for testing). */
export function resetR2Client(): void {
  _client = null;
}
