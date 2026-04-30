import type { NextConfig } from "next";

const HEAVY_PACKAGES = [
  "node_modules/playwright/**",
  "node_modules/playwright-core/**",
  "node_modules/@playwright/**",
  "node_modules/sharp/**",
  "node_modules/lighthouse/**",
  "node_modules/chrome-launcher/**",
  "node_modules/axe-core/**",
  "scripts/**",
];

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "playwright",
    "playwright-core",
    "sharp",
    "lighthouse",
    "chrome-launcher",
    "axe-core",
  ],
  outputFileTracingExcludes: {
    "*": HEAVY_PACKAGES,
  },
};

export default nextConfig;
