export type HostingKind = "site" | "bot" | "cdn";
export type HostingStep = "kind" | "github" | "repository" | "region" | "plan" | "payment" | "ready";

export type HostingGitHubAccount = {
  id: string;
  login: string;
  name: string;
  avatarUrl: string | null;
  type: "user" | "organization";
};

export type HostingRepository = {
  id: string;
  nodeId?: string | null;
  owner: string;
  name: string;
  fullName?: string;
  description: string;
  language: string;
  updatedAt: string;
  branch: string;
  private: boolean;
  htmlUrl?: string;
};

export type HostingRegion = {
  id: string;
  name: string;
  country: string;
  city: string;
  pingMs: number;
  status: "available" | "soon";
  coordinates: {
    x: number;
    y: number;
  };
};

export type HostingPlan = {
  id: string;
  kind: HostingKind;
  name: string;
  badge: string;
  recommended?: boolean;
  monthlyAmount: number;
  compareMonthlyAmount: number;
  currency: string;
  billingLabel: string;
  cycleBadge: string;
  limitedOffer: string;
  description: string;
  specs: string[];
  paymentPlanCode: "pro" | "ultra" | "master";
};

export const HOSTING_STEP_PATH_BY_STEP: Record<HostingStep, string> = {
  kind: "/dashboard/hosting/step-1",
  github: "/dashboard/hosting/step-2",
  repository: "/dashboard/hosting/step-3",
  region: "/dashboard/hosting/step-4",
  plan: "/dashboard/hosting/step-5",
  payment: "/dashboard/hosting/step-6",
  ready: "/dashboard/hosting/step-7",
};

export const HOSTING_STEP_BY_PATH_SEGMENT: Record<string, HostingStep> = {
  "step-1": "kind",
  "step-2": "github",
  "step-3": "repository",
  "step-4": "region",
  "step-5": "plan",
  "step-6": "payment",
  "step-7": "ready",
};

export const HOSTING_KIND_OPTIONS: Array<{
  id: HostingKind;
  title: string;
  label: string;
  description: string;
  bullets: string[];
}> = [
  {
    id: "site",
    title: "Site",
    label: "Hospedar site",
    description: "Deploy de sites, landing pages, dashboards e APIs leves puxando direto do GitHub.",
    bullets: ["Build automatico", "Dominios e SSL", "Logs em tempo real"],
  },
  {
    id: "bot",
    title: "Bot",
    label: "Hospedar bot",
    description: "Projetos Node, Python ou workers para Discord, WhatsApp e automacoes em VPS Windows.",
    bullets: ["Processo persistente", "Restart automatico", "Variaveis seguras"],
  },
  {
    id: "cdn",
    title: "Imagens / CDN",
    label: "Hospedar imagens/CDN",
    description: "Armazenamento e entrega de imagens, arquivos estaticos e assets de produto.",
    bullets: ["Links publicos", "Cache otimizado", "Controle de uso"],
  },
];

export const HOSTING_REGIONS: HostingRegion[] = [
  {
    id: "br-sp",
    name: "Sao Paulo, Brasil",
    country: "Brasil",
    city: "Sao Paulo",
    pingMs: 18,
    status: "available",
    coordinates: {
      x: 38,
      y: 74,
    },
  },
];

export const MOCK_GITHUB_REPOSITORIES: HostingRepository[] = [
  {
    id: "repo-flowdesk-site",
    owner: "MuriloFlow",
    name: "flowdesk-site",
    description: "Site institucional com Next.js, painel e rotas de API.",
    language: "TypeScript",
    updatedAt: "Atualizado hoje",
    branch: "main",
    private: true,
  },
  {
    id: "repo-discord-bot",
    owner: "MuriloFlow",
    name: "discord-support-bot",
    description: "Bot de suporte para Discord com filas, tickets e automacoes.",
    language: "JavaScript",
    updatedAt: "Atualizado ontem",
    branch: "main",
    private: true,
  },
  {
    id: "repo-whatsapp-agent",
    owner: "MuriloFlow",
    name: "whatsapp-agent",
    description: "Agente WhatsApp para atendimento, webhooks e respostas automaticas.",
    language: "Python",
    updatedAt: "Atualizado ha 3 dias",
    branch: "production",
    private: false,
  },
  {
    id: "repo-assets-cdn",
    owner: "MuriloFlow",
    name: "brand-assets-cdn",
    description: "Bucket de imagens, icones e arquivos estaticos para produtos.",
    language: "Static",
    updatedAt: "Atualizado ha 6 dias",
    branch: "main",
    private: false,
  },
];

export const HOSTING_PLANS: Record<HostingKind, HostingPlan[]> = {
  site: [
    {
      id: "site-start",
      kind: "site",
      name: "Site Start",
      badge: "Starter",
      monthlyAmount: 9.99,
      compareMonthlyAmount: 19.9,
      currency: "BRL",
      billingLabel: "/mes",
      cycleBadge: "Ideal para landing pages",
      limitedOffer: "Deploy essencial",
      description: "Para sites pequenos, paginas de venda e projetos front-end com baixo consumo.",
      specs: ["0.5 vCPU compartilhado", "768 MB de RAM", "5 GB NVMe", "80 GB de trafego", "SSL incluso"],
      paymentPlanCode: "pro",
    },
    {
      id: "site-pro",
      kind: "site",
      name: "Site Pro",
      badge: "Popular",
      recommended: true,
      monthlyAmount: 19.9,
      compareMonthlyAmount: 49.9,
      currency: "BRL",
      billingLabel: "/mes",
      cycleBadge: "Mais escolhido para SaaS",
      limitedOffer: "Builds rapidos",
      description: "Para dashboards, APIs leves e sites com trafego recorrente.",
      specs: ["1 vCPU", "2 GB de RAM", "20 GB NVMe", "350 GB de trafego", "Preview deployments"],
      paymentPlanCode: "ultra",
    },
    {
      id: "site-scale",
      kind: "site",
      name: "Site Scale",
      badge: "Scale",
      monthlyAmount: 29.9,
      compareMonthlyAmount: 99.9,
      currency: "BRL",
      billingLabel: "/mes",
      cycleBadge: "Para operacoes maiores",
      limitedOffer: "Alta disponibilidade",
      description: "Para produtos maiores, rotas dinamicas e maior volume de usuarios.",
      specs: ["2 vCPU", "4 GB de RAM", "45 GB NVMe", "1 TB de trafego", "Prioridade de build"],
      paymentPlanCode: "master",
    },
  ],
  bot: [
    {
      id: "bot-start",
      kind: "bot",
      name: "Bot Start",
      badge: "Worker",
      monthlyAmount: 9.99,
      compareMonthlyAmount: 19.9,
      currency: "BRL",
      billingLabel: "/mes",
      cycleBadge: "Para bots pequenos",
      limitedOffer: "Processo 24/7",
      description: "Para bots Discord, WhatsApp e automacoes com consumo leve.",
      specs: ["0.5 vCPU", "768 MB de RAM", "5 GB NVMe", "1 processo 24/7", "Restart automatico"],
      paymentPlanCode: "pro",
    },
    {
      id: "bot-pro",
      kind: "bot",
      name: "Bot Pro",
      badge: "Popular",
      recommended: true,
      monthlyAmount: 19.9,
      compareMonthlyAmount: 49.9,
      currency: "BRL",
      billingLabel: "/mes",
      cycleBadge: "Para comunidades ativas",
      limitedOffer: "Mais estabilidade",
      description: "Para bots com webhooks, filas, comandos e atendimento em tempo real.",
      specs: ["1 vCPU", "2 GB de RAM", "20 GB NVMe", "2 processos 24/7", "Health checks"],
      paymentPlanCode: "ultra",
    },
    {
      id: "bot-scale",
      kind: "bot",
      name: "Bot Scale",
      badge: "Scale",
      monthlyAmount: 29.9,
      compareMonthlyAmount: 99.9,
      currency: "BRL",
      billingLabel: "/mes",
      cycleBadge: "Para bots grandes",
      limitedOffer: "Fila dedicada",
      description: "Para operacoes maiores com multiplos workers, webhooks e shards.",
      specs: ["2 vCPU", "4 GB de RAM", "50 GB NVMe", "4 processos 24/7", "Fila dedicada"],
      paymentPlanCode: "master",
    },
  ],
  cdn: [
    {
      id: "cdn-start",
      kind: "cdn",
      name: "CDN Start",
      badge: "Assets",
      monthlyAmount: 9.99,
      compareMonthlyAmount: 19.9,
      currency: "BRL",
      billingLabel: "/mes",
      cycleBadge: "Para imagens leves",
      limitedOffer: "Entrega estatica",
      description: "Para imagens, icones e arquivos estaticos de projetos pequenos.",
      specs: ["10 GB de armazenamento", "150 GB de trafego", "Cache pronto", "Links publicos", "Logs basicos"],
      paymentPlanCode: "pro",
    },
    {
      id: "cdn-pro",
      kind: "cdn",
      name: "CDN Pro",
      badge: "Popular",
      recommended: true,
      monthlyAmount: 19.9,
      compareMonthlyAmount: 49.9,
      currency: "BRL",
      billingLabel: "/mes",
      cycleBadge: "Para lojas e paineis",
      limitedOffer: "Cache otimizado",
      description: "Para bibliotecas de imagem, anexos de produto e assets frequentes.",
      specs: ["50 GB de armazenamento", "600 GB de trafego", "Cache inteligente", "URLs assinadas", "Compressao de imagem"],
      paymentPlanCode: "ultra",
    },
    {
      id: "cdn-scale",
      kind: "cdn",
      name: "CDN Scale",
      badge: "Scale",
      monthlyAmount: 29.9,
      compareMonthlyAmount: 99.9,
      currency: "BRL",
      billingLabel: "/mes",
      cycleBadge: "Para alto volume",
      limitedOffer: "Storage ampliado",
      description: "Para operacoes com alto volume de imagens, videos curtos e downloads.",
      specs: ["120 GB de armazenamento", "1.5 TB de trafego", "Cache avancado", "Regras por pasta", "Relatorios de uso"],
      paymentPlanCode: "master",
    },
  ],
};

export function getHostingKindLabel(kind: HostingKind) {
  return HOSTING_KIND_OPTIONS.find((option) => option.id === kind)?.title || "Hospedagem";
}
