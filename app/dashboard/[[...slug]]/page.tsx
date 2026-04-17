import { redirect } from "next/navigation";
import { resolveDashboardViewFromSlug } from "@/lib/dashboard/navigation";

type DashboardPageProps = {
  params: Promise<{
    slug?: string[];
  }>;
};

export default async function DashboardPage({ params }: DashboardPageProps) {
  const routeParams = await params;
  const normalizedSlug = Array.isArray(routeParams.slug) ? routeParams.slug : [];

  if (normalizedSlug[0]?.toLowerCase() === "servers") {
    redirect("/servers");
  }

  const currentView = resolveDashboardViewFromSlug(normalizedSlug);
  if (!currentView) {
    redirect("/dashboard");
  }

  return null;
}
