// docs/17 §端口与部署: pika-api Worker entry. main = src/index.ts.
// Re-exports createApp for test consumers (app.test.ts) and provides a
// default fetch handler for wrangler runtime.
import { createApp } from "./app";

export { createApp } from "./app";

const app = createApp();

export default {
  fetch: app.fetch,
};
