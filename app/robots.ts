import type { MetadataRoute } from "next";
import {
  buildFlowCwvUrl,
  FLOWCWV_SITE_ORIGIN,
} from "@/lib/seo/flowCwv";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/affiliates", "/domains", "/status", "/privacy", "/terms"],
        disallow: [
          "/api/",
          "/login",
          "/account",
          "/dashboard",
          "/servers",
          "/config",
          "/payment",
          "/discord/link",
          "/domains/search",
          "/domains/flowai/search",
        ],
      },
    ],
    sitemap: [buildFlowCwvUrl("/sitemap.xml")],
    host: FLOWCWV_SITE_ORIGIN,
  };
}
