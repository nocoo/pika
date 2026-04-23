/**
 * Web-side R2 client wrapper.
 *
 * Re-exports the runtime-agnostic class from @pika/core/infra/r2 and adds:
 *  - getR2Client(): singleton factory reading process.env
 *  - resetR2Client(): test helper
 *  - assertTestBucket(): wrapper that reads CF_R2_BUCKET from env
 */

import {
  assertTestBucket as coreAssertTestBucket,
  R2Client,
} from "@pika/core/infra/r2";

export {
  R2Client,
  type R2Config,
  TEST_BUCKET_NAME,
} from "@pika/core/infra/r2";

let _client: R2Client | null = null;

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

export function resetR2Client(): void {
  _client = null;
}

export function assertTestBucket(): void {
  coreAssertTestBucket(process.env.CF_R2_BUCKET);
}
