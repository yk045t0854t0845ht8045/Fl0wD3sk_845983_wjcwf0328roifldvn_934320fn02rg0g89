import type { Metadata } from "next";
import { DomainsPageShell } from "./DomainsPageShell";
import { buildFlowCwvMetadata } from "@/lib/seo/flowCwv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = buildFlowCwvMetadata({
  title: "Dominios, busca e naming com IA",
  description:
    "Pesquise dominios, valide disponibilidade e use IA para encontrar nomes de marca, projetos e operacoes digitais com mais clareza e velocidade.",
  pathname: "/domains",
  keywords: [
    "dominios",
    "registro de dominios",
    "nomes com ia",
    "naming",
    "busca de dominios",
  ],
});

export default async function DomainsPage() {
  return <DomainsPageShell initialMode="register" />;
}
