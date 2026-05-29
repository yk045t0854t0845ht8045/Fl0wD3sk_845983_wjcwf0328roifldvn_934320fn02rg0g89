import { notFound } from "next/navigation";

import VpsPanelPage from "../page";

const VPS_TAB_SEGMENTS = new Set([
  "overview",
  "metrics",
  "metricas",
  "console",
  "files",
  "arquivos",
  "deployments",
  "deploys",
  "environment-variables",
  "env",
  "variables",
]);

type VpsPanelTabPageProps = {
  params: Promise<{
    code: string;
    tab: string;
  }>;
};

export default async function VpsPanelTabPage({ params }: VpsPanelTabPageProps) {
  const routeParams = await params;
  if (!VPS_TAB_SEGMENTS.has(routeParams.tab.toLowerCase())) {
    notFound();
  }

  return VpsPanelPage({
    params: Promise.resolve({ code: routeParams.code }),
  });
}
