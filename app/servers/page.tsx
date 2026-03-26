import { redirect } from "next/navigation";
import { ServersWorkspace } from "@/components/servers/ServersWorkspace";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";

type ServersPageProps = {
  searchParams?: Promise<{
    guild?: string | string[];
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

export default async function ServersPage({ searchParams }: ServersPageProps) {
  const user = await getCurrentUserFromSessionCookie();

  if (!user) {
    redirect("/login");
  }

  const query = searchParams ? await searchParams : {};
  const legacyGuildId = normalizeGuildId(takeFirstQueryValue(query.guild));
  const legacyTab = normalizeServerTab(takeFirstQueryValue(query.tab));

  if (legacyGuildId) {
    if (legacyTab === "settings") {
      redirect(`/servers/${legacyGuildId}`);
    }
    redirect(`/servers/${legacyGuildId}?tab=${legacyTab}`);
  }

  return (
    <ServersWorkspace displayName={user.display_name} />
  );
}
