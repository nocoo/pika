import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["pika.dev.hexly.ai"],
};

export default nextConfig;
