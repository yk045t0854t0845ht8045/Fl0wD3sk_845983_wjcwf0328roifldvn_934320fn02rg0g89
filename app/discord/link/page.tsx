import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DiscordLinkPageClient } from "@/components/discord-link/DiscordLinkPageClient";
import {
  getDiscordLinkAccessQueryParam,
  getDiscordLinkStatusQueryParam,
} from "@/lib/discordLink/linkAccess";
import { OFFICIAL_DISCORD_LINK_START_PATH } from "@/lib/discordLink/config";
import { buildFlowCwvMetadata } from "@/lib/seo/flowCwv";

export const metadata: Metadata = buildFlowCwvMetadata({
  title: "Vincular conta Discord | Flowdesk",
  description:
    "Vincule sua conta do Discord ao Flowdesk para sincronizar o acesso e liberar automaticamente seu cargo no servidor oficial.",
  pathname: "/discord/link",
  noIndex: true,
  keywords: ["discord", "vincular conta", "sincronizacao"],
});

type DiscordLinkPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function takeFirstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

export default async function DiscordLinkPage({ searchParams }: DiscordLinkPageProps) {
  const query = searchParams ? await searchParams : {};
  const accessToken = takeFirstQueryValue(query[getDiscordLinkAccessQueryParam()]);
  const initialStatus = takeFirstQueryValue(query[getDiscordLinkStatusQueryParam()]);

  if (!accessToken) {
    redirect(OFFICIAL_DISCORD_LINK_START_PATH);
  }

  return (
    <DiscordLinkPageClient
      accessToken={accessToken}
      initialStatus={initialStatus}
    />
  );
}
