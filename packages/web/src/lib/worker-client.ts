/**
 * Web-side Worker HTTP client wrapper.
 *
 * Re-exports the runtime-agnostic class from @pika/core/infra/worker-client
 * and adds a singleton factory that reads WORKER_URL / WORKER_SECRET from
 * process.env.
 */

import { WorkerClient } from "@pika/core/infra/worker-client";

export {
  WorkerClient,
  type WorkerClientConfig,
  WorkerError,
} from "@pika/core/infra/worker-client";

let clientInstance: WorkerClient | null = null;

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

export function resetWorkerClient(): void {
  clientInstance = null;
}
