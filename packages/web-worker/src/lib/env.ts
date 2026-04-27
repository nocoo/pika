import type { ApiTokenExecutor } from "@pika/core";
import type { UserExecutor } from "./resolve-user";

export interface AppEnv {
  Bindings: {
    DB: D1Database;
    BUCKET: R2Bucket;
    ASSETS: { fetch: (req: Request) => Promise<Response> };
    ENVIRONMENT?: string;
    E2E_SKIP_AUTH?: string;
    CF_ACCESS_TEAM_DOMAIN?: string;
    CF_ACCESS_AUD?: string;
    DEV_USER_EMAIL?: string;
    CF_R2_ACCESS_KEY_ID?: string;
    CF_R2_SECRET_ACCESS_KEY?: string;
    CF_R2_ENDPOINT?: string;
    CF_R2_BUCKET?: string;
  };
  Variables: {
    accessAuthenticated?: boolean;
    accessEmail?: string;
    userId?: string;
    apiTokenExec?: ApiTokenExecutor;
    userExec?: UserExecutor;
  };
}
