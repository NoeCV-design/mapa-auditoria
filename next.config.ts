import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "playwright",
    "playwright-core",
    "sharp",
    "lighthouse",
    "chrome-launcher",
    "axe-core",
  ],
};

export default nextConfig;
