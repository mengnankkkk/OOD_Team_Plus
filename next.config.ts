import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  output: "standalone",
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
