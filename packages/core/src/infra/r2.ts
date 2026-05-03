/**
 * Cloudflare R2 client.
 *
 * Generates presigned GET/PUT URLs and direct object access via the
 * S3-compatible API exposed by R2. Runtime-agnostic: caller supplies
 * config; the web/Next.js layer adds a singleton factory + env reads.
 */

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface R2Config {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucket: string;
}

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
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

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

  async getObject(key: string): Promise<Uint8Array | null> {
    try {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!res.Body) return null;
      return res.Body.transformToByteArray();
    } catch (err: unknown) {
      const code = (err as { name?: string }).name;
      if (code === "NoSuchKey" || code === "NotFound") return null;
      throw err;
    }
  }

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

  async headObject(key: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
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
