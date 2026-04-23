import { createApp } from "./app";

declare const Bun: {
  serve: (opts: {
    port: number;
    fetch: (req: Request) => Response | Promise<Response>;
  }) => { port: number };
};

const app = createApp();
const port = Number.parseInt(process.env.PORT ?? "7023", 10);

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`[api] listening on http://localhost:${server.port}`);
