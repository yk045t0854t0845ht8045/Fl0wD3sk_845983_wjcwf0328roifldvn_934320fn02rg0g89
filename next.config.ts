import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  trailingSlash: false,
  skipTrailingSlashRedirect: true,
  outputFileTracingRoot: appRoot,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  images: {
    loader: "custom",
    loaderFile: "./lib/images/flowSecureLoader.ts",
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24,
    contentDispositionType: "inline",
    dangerouslyAllowSVG: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
      },
      {
        protocol: "https",
        hostname: "media.discordapp.net",
      },
      {
        protocol: "https",
        hostname: "images-ext-1.discordapp.net",
      },
      {
        protocol: "https",
        hostname: "images-ext-2.discordapp.net",
      },
      {
        protocol: "https",
        hostname: "cdn.flwdesk.com",
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
