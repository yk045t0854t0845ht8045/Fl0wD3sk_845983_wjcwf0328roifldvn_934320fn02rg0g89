import type { MetadataRoute } from "next";
import { buildFlowCwvPublicSitemapEntries } from "@/lib/seo/flowCwv";

export default function sitemap(): MetadataRoute.Sitemap {
  return buildFlowCwvPublicSitemapEntries();
}
