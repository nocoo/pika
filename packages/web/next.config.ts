import { createRequire } from "module";
import type { NextConfig } from "next";

const require = createRequire(import.meta.url);
const rootPkg = require("../../package.json") as { version: string };

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["pika.dev.hexly.ai"],
  env: {
    NEXT_PUBLIC_APP_VERSION: rootPkg.version,
  },
};

export default nextConfig;
