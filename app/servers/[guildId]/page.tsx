import { redirect } from "next/navigation";

type ServersByGuildPageProps = {
  params: Promise<{
    guildId: string;
  }>;
  searchParams?: Promise<{
    tab?: string | string[];
  }>;
};

function normalizeGuildId(value: string | null) {
  if (!value) return null;
  const guildId = value.trim();
  return /^\d{10,25}$/.test(guildId) ? guildId : null;
}

export default async function ServersByGuildPage({
  params,
  searchParams,
}: ServersByGuildPageProps) {
  const routeParams = await params;
  const safeGuildId = normalizeGuildId(routeParams.guildId);

  if (!safeGuildId) {
    redirect("/servers/");
  }

  if (searchParams) {
    await searchParams;
  }

  redirect(`/servers/${safeGuildId}/tickets/overview/`);
}
