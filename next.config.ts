import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "*": ["public/screenshots/**"],
  },
};

export default nextConfig;
