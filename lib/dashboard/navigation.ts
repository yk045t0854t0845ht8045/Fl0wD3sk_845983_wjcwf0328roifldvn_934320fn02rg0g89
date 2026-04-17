export type DashboardViewId =
  | "home"
  | "domains_overview"
  | "domains_acquire"
  | "domains_transfers"
  | "flowai_api"
  | "hosting"
  | "billing_subscriptions"
  | "billing_payment_history"
  | "billing_payment_methods";

export type DashboardView = {
  id: DashboardViewId;
  href: string;
  title: string;
  description: string;
  isEmptyHome?: boolean;
};

const DASHBOARD_VIEWS: Record<DashboardViewId, DashboardView> = {
  home: {
    id: "home",
    href: "/dashboard",
    title: "Inicio",
    description: "Seu painel central da Flowdesk.",
    isEmptyHome: true,
  },
  domains_overview: {
    id: "domains_overview",
    href: "/dashboard/domains",
    title: "Meus Dominios",
    description: "Gerencie os dominios vinculados a sua conta em um unico lugar.",
  },
  domains_acquire: {
    id: "domains_acquire",
    href: "/dashboard/domains/acquire",
    title: "Adquirir dominio",
    description: "Area preparada para compra e provisionamento de novos dominios.",
  },
  domains_transfers: {
    id: "domains_transfers",
    href: "/dashboard/domains/transfers",
    title: "Transferencias",
    description: "Acompanhe a entrada de dominios transferidos para sua operacao.",
  },
  flowai_api: {
    id: "flowai_api",
    href: "/dashboard/flowai-api",
    title: "FlowAI API",
    description: "Central futura para chaves, consumo e configuracoes da FlowAI API.",
  },
  hosting: {
    id: "hosting",
    href: "/dashboard/hosting",
    title: "Hospedagem",
    description: "Area futura para servicos de hospedagem e infraestrutura gerenciada.",
  },
  billing_subscriptions: {
    id: "billing_subscriptions",
    href: "/dashboard/billing/subscriptions",
    title: "Assinaturas",
    description: "Visualize e controle o estado atual das suas assinaturas.",
  },
  billing_payment_history: {
    id: "billing_payment_history",
    href: "/dashboard/billing/payment-history",
    title: "Historico de Pagamentos",
    description: "Consulte pagamentos anteriores e eventos financeiros da sua conta.",
  },
  billing_payment_methods: {
    id: "billing_payment_methods",
    href: "/dashboard/billing/payment-methods",
    title: "Metodos de pagamento",
    description: "Gerencie os metodos salvos e a configuracao de cobranca da conta.",
  },
};

export function getDashboardViewById(id: DashboardViewId) {
  return DASHBOARD_VIEWS[id];
}

export function resolveDashboardViewFromSlug(slug?: string[]) {
  if (!slug || slug.length === 0) {
    return DASHBOARD_VIEWS.home;
  }

  const normalizedSlug = slug.map((segment) => segment.trim().toLowerCase()).filter(Boolean);
  const path = normalizedSlug.join("/");

  switch (path) {
    case "domains":
      return DASHBOARD_VIEWS.domains_overview;
    case "domains/acquire":
      return DASHBOARD_VIEWS.domains_acquire;
    case "domains/transfers":
      return DASHBOARD_VIEWS.domains_transfers;
    case "flowai-api":
      return DASHBOARD_VIEWS.flowai_api;
    case "hosting":
      return DASHBOARD_VIEWS.hosting;
    case "billing/subscriptions":
      return DASHBOARD_VIEWS.billing_subscriptions;
    case "billing/payment-history":
      return DASHBOARD_VIEWS.billing_payment_history;
    case "billing/payment-methods":
      return DASHBOARD_VIEWS.billing_payment_methods;
    default:
      return null;
  }
}

export function resolveDashboardViewFromPathname(pathname: string) {
  const normalizedPath = pathname
    .split("?")[0]
    .split("#")[0]
    .replace(/^\/+|\/+$/g, "");

  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments[0] !== "dashboard") {
    return null;
  }

  return resolveDashboardViewFromSlug(segments.slice(1));
}
