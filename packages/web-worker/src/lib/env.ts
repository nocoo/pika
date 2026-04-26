import type { ApiTokenExecutor } from "@pika/core";
import type { UserExecutor } from "./resolve-user";

export interface AppEnv {
  Bindings: {
    DB: D1Database;
    ASSETS: { fetch: (req: Request) => Promise<Response> };
    ENVIRONMENT?: string;
    E2E_SKIP_AUTH?: string;
    CF_ACCESS_TEAM_DOMAIN?: string;
    CF_ACCESS_AUD?: string;
    DEV_USER_EMAIL?: string;
  };
  Variables: {
    accessAuthenticated?: boolean;
    accessEmail?: string;
    userId?: string;
    apiTokenExec?: ApiTokenExecutor;
    userExec?: UserExecutor;
  };
}
