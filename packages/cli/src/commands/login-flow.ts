import http from "node:http";
import type { ConfigManager } from "../config/manager";

export interface LoginDeps {
  openBrowser: (url: string) => Promise<void>;
  log?: (msg: string) => void;
  config: ConfigManager;
  apiUrl: string;
  timeoutMs: number;
}

export interface LoginResult {
  success: boolean;
  email?: string;
  error?: string;
}

export function performLogin(deps: LoginDeps): Promise<LoginResult> {
  return new Promise((resolve) => {
    const { openBrowser, log, config, apiUrl, timeoutMs } = deps;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`);

      if (url.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      const apiKey = url.searchParams.get("api_key");
      const email = url.searchParams.get("email");

      if (!apiKey) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing api_key");
        cleanup();
        resolve({ success: false, error: "No api_key received" });
        return;
      }

      // Save the token
      config.write({ token: apiKey });

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<html><body><h1>Login successful!</h1><p>You can close this window.</p></body></html>",
      );

      cleanup();
      resolve({ success: true, email: email || undefined });
    });

    // Listen on random port
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        cleanup();
        resolve({ success: false, error: "Failed to start local server" });
        return;
      }

      const callbackUrl = `http://127.0.0.1:${addr.port}/callback`;
      const loginUrl = `${apiUrl}/api/auth/cli?callback=${encodeURIComponent(callbackUrl)}`;

      openBrowser(loginUrl).catch(() => {
        // Browser failed — print URL so user can open manually
        if (log) {
          log(`Could not open browser. Open this URL manually:\n  ${loginUrl}`);
        }
      });
    });

    server.on("error", (err) => {
      cleanup();
      resolve({ success: false, error: `Local server error: ${err.message}` });
    });

    // Timeout
    const timer = setTimeout(() => {
      cleanup();
      resolve({ success: false, error: "Login timeout — no response received" });
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      server.close();
    }
  });
}
