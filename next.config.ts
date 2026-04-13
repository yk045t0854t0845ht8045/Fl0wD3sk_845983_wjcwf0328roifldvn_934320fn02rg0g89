import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  trailingSlash: true,
  outputFileTracingRoot: appRoot,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
      },
    ],
  },
  turbopack: {
    root: appRoot,
  },
  async redirects() {
    return [
      {
        source: "/tos/",
        destination: "/terms/",
        permanent: true,
      },
      {
        source: "/rules/",
        destination: "/privacy/",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
