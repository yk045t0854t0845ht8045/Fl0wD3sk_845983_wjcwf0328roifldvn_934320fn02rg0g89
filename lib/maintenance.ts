import { getServerEnv } from "@/lib/serverEnv";

export type MaintenanceArea =
  | "landing"
  | "affiliates"
  | "domains"
  | "servers"
  | "account"
  | "status";

type MaintenanceContent = {
  envKey: string;
  title: string;
  description: string;
  fallbackHref: string;
};

const MAINTENANCE_CONTENT: Record<MaintenanceArea, MaintenanceContent> = {
  landing: {
    envKey: "MANUTENTION_LANDING",
    title: "Landing em breve disponivel",
    description:
      "Estamos preparando a pagina inicial para uma liberacao melhor. Tente novamente em instantes ou volte para outra area da Flowdesk.",
    fallbackHref: "/login",
  },
  affiliates: {
    envKey: "MANUTENTION_AFFILIATES",
    title: "Programa de afiliados em breve disponivel",
    description:
      "Esta area esta passando por ajustes antes de ser reaberta. Volte em breve para continuar usando o programa de afiliados.",
    fallbackHref: "/",
  },
  domains: {
    envKey: "MANUTENTION_DOMAINS",
    title: "Sistema de dominios em manutencao",
    description:
      "A area de dominios esta temporariamente indisponivel enquanto finalizamos algumas melhorias. Tente novamente em breve.",
    fallbackHref: "/",
  },
  servers: {
    envKey: "MANUTENTION_SERVERS",
    title: "Painel de servidores em manutencao",
    description:
      "Estamos ajustando o painel de servidores para liberar esta area com mais estabilidade. Volte em breve.",
    fallbackHref: "/",
  },
  account: {
    envKey: "MANUTENTION_ACCOUNT",
    title: "Area da conta em manutencao",
    description:
      "Sua area de conta esta temporariamente em manutencao. Tente novamente em alguns instantes.",
    fallbackHref: "/",
  },
  status: {
    envKey: "MANUTENTION_STATUS",
    title: "Pagina de status em manutencao",
    description:
      "Estamos reorganizando a pagina de status para voltar com informacoes mais confiaveis. Tente novamente em breve.",
    fallbackHref: "/",
  },
};

function parseBooleanFlag(value: string | undefined) {
  if (!value) {
    return false;
  }

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      return false;
  }
}

export function isMaintenanceEnabled(area: MaintenanceArea) {
  return parseBooleanFlag(getServerEnv(MAINTENANCE_CONTENT[area].envKey));
}

export function getMaintenanceContent(area: MaintenanceArea) {
  return MAINTENANCE_CONTENT[area];
}

export function shouldBypassMaintenanceForHost(host: string | null) {
  if (!host) {
    return false;
  }

  const normalizedHost = host
    .split(",")[0]
    ?.trim()
    .toLowerCase() || "";

  return (
    normalizedHost.startsWith("localhost:") ||
    normalizedHost === "localhost" ||
    normalizedHost.startsWith("127.0.0.1:") ||
    normalizedHost === "127.0.0.1" ||
    normalizedHost.startsWith("0.0.0.0:") ||
    normalizedHost === "0.0.0.0" ||
    normalizedHost.startsWith("[::1]:") ||
    normalizedHost === "[::1]" ||
    normalizedHost.endsWith(".localhost")
  );
}
