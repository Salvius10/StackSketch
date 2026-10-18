import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@stacksketch/graph"],
  // The browser reaches the FastAPI service through this proxy, same origin.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default config;
