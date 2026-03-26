import { redirect } from "next/navigation";
import { ServersWorkspace } from "@/components/servers/ServersWorkspace";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";

type ServersByGuildPageProps = {
  params: Promise<{
    guildId: string;
  }>;
  searchParams?: Promise<{
    tab?: string | string[];
  }>;
};

function takeFirstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function normalizeGuildId(value: string | null) {
  if (!value) return null;
  const guildId = value.trim();
  return /^\d{10,25}$/.test(guildId) ? guildId : null;
}

function normalizeServerTab(value: string | null) {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "payments") return "payments" as const;
  if (normalized === "methods") return "methods" as const;
  if (normalized === "plans") return "plans" as const;
  return "settings" as const;
}

export default async function ServersByGuildPage({
  params,
  searchParams,
}: ServersByGuildPageProps) {
  const user = await getCurrentUserFromSessionCookie();

  if (!user) {
    redirect("/login");
  }

  const routeParams = await params;
  const safeGuildId = normalizeGuildId(routeParams.guildId);

  if (!safeGuildId) {
    redirect("/servers");
  }

  const query = searchParams ? await searchParams : {};
  const tab = normalizeServerTab(takeFirstQueryValue(query.tab));

  return (
    <ServersWorkspace
      displayName={user.display_name}
      initialGuildId={safeGuildId}
      initialTab={tab}
    />
  );
}
