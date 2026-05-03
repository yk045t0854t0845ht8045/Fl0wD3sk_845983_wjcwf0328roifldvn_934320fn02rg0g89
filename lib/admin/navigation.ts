import type { AdminPermissionCode } from "@/lib/admin/permissions";

export type AdminNavIconKey =
  | "overview"
  | "team"
  | "roles"
  | "permissions"
  | "users"
  | "servers"
  | "domains"
  | "hosting"
  | "payments"
  | "billing"
  | "support"
  | "status"
  | "security"
  | "flowai"
  | "testVariables"
  | "audit"
  | "settings";

export type AdminNavItem = {
  id: string;
  label: string;
  href: string;
  icon: AdminNavIconKey;
  permission: AdminPermissionCode;
  status: "active" | "planned";
  badge?: string | null;
};

export type AdminNavSection = {
  id: string;
  label: string;
  items: AdminNavItem[];
};

export type AdminPageMeta = {
  eyebrow: string;
  title: string;
  description: string;
};

export const ADMIN_NAV_SECTIONS: AdminNavSection[] = [
  {
    id: "overview",
    label: "Visao Geral",
    items: [
      {
        id: "admin-home",
        label: "Overview",
        href: "/admin",
        icon: "overview",
        permission: "admin.overview.read",
        status: "active",
      },
    ],
  },
  {
    id: "governance",
    label: "Governanca",
    items: [
      {
        id: "admin-team",
        label: "Equipe",
        href: "/admin/team",
        icon: "team",
        permission: "team.read",
        status: "active",
      },
      {
        id: "admin-roles",
        label: "Cargos",
        href: "/admin/roles",
        icon: "roles",
        permission: "roles.read",
        status: "active",
      },
      {
        id: "admin-permissions",
        label: "Permissoes",
        href: "/admin/permissions",
        icon: "permissions",
        permission: "permissions.read",
        status: "active",
      },
      {
        id: "admin-audit",
        label: "Auditoria",
        href: "/admin/audit",
        icon: "audit",
        permission: "audit.read",
        status: "active",
      },
    ],
  },
  {
    id: "operations",
    label: "Operacao",
    items: [
      {
        id: "admin-users",
        label: "Usuarios",
        href: "/admin/users",
        icon: "users",
        permission: "users.read",
        status: "active",
      },
      {
        id: "admin-customers",
        label: "Clientes",
        href: "/admin/customers",
        icon: "users",
        permission: "customers.read",
        status: "active",
      },
      {
        id: "admin-servers",
        label: "Servidores",
        href: "/admin/servers",
        icon: "servers",
        permission: "servers.read",
        status: "active",
      },
      {
        id: "admin-domains",
        label: "Dominios",
        href: "/admin/domains",
        icon: "domains",
        permission: "domains.read",
        status: "active",
      },
      {
        id: "admin-hosting",
        label: "Hospedagem",
        href: "/admin/hosting",
        icon: "hosting",
        permission: "hosting.read",
        status: "active",
      },
      {
        id: "admin-payments",
        label: "Pagamentos",
        href: "/admin/payments",
        icon: "payments",
        permission: "payments.read",
        status: "active",
      },
      {
        id: "admin-billing",
        label: "Billing",
        href: "/admin/billing",
        icon: "billing",
        permission: "billing.read",
        status: "active",
      },
      {
        id: "admin-support",
        label: "Suporte",
        href: "/admin/support",
        icon: "support",
        permission: "support.read",
        status: "active",
      },
      {
        id: "admin-status",
        label: "Status",
        href: "/admin/status",
        icon: "status",
        permission: "status.read",
        status: "active",
      },
      {
        id: "admin-security",
        label: "Seguranca",
        href: "/admin/security",
        icon: "security",
        permission: "security.read",
        status: "active",
      },
      {
        id: "admin-flowai",
        label: "FlowAI",
        href: "/admin/flowai",
        icon: "flowai",
        permission: "flowai.read",
        status: "active",
      },
    ],
  },
  {
    id: "developer",
    label: "Dev Environment",
    items: [
      {
        id: "admin-test-variables",
        label: "Test Variables",
        href: "/admin/test-variables",
        icon: "testVariables",
        permission: "test_variables.read",
        status: "active",
      },
      {
        id: "admin-settings",
        label: "Configuracoes",
        href: "/admin/settings",
        icon: "settings",
        permission: "settings.read",
        status: "active",
      },
    ],
  },
];

const ADMIN_PAGE_META_BY_PATH: Array<[path: string, meta: AdminPageMeta]> = [
  [
    "/admin/settings",
    {
      eyebrow: "Governanca",
      title: "Configuracoes",
      description:
        "Estado de prontidao das configuracoes estruturais do admin, hosts canonicos e FlowSecure sem expor segredos no painel.",
    },
  ],
  [
    "/admin/flowai",
    {
      eyebrow: "Operacao",
      title: "FlowAI",
      description:
        "Observabilidade da fila FlowAI e dos eventos de uso reais persistidos pelo backend interno.",
    },
  ],
  [
    "/admin/security",
    {
      eyebrow: "Seguranca",
      title: "Seguranca",
      description:
        "Eventos de request security, allowlist FLWIP, certificados ativos e trilhas bloqueadas de test variables em uma unica superficie.",
    },
  ],
  [
    "/admin/status",
    {
      eyebrow: "Operacao",
      title: "Status",
      description:
        "Leitura administrativa do sistema de status publico, incidentes e componentes monitorados da Flowdesk.",
    },
  ],
  [
    "/admin/support",
    {
      eyebrow: "Operacao",
      title: "Suporte",
      description:
        "Fila real de tickets com contexto de protocolo, solicitante, guilda e status operacional.",
    },
  ],
  [
    "/admin/hosting",
    {
      eyebrow: "Operacao",
      title: "Hospedagem",
      description:
        "Saude institucional dos componentes de runtime, API e tarefas agendadas que sustentam a plataforma.",
    },
  ],
  [
    "/admin/domains",
    {
      eyebrow: "Operacao",
      title: "Dominios",
      description:
        "Camada administrativa sobre os checks reais de DNS, SSL e registro observados pelo status institucional.",
    },
  ],
  [
    "/admin/servers",
    {
      eyebrow: "Operacao",
      title: "Servidores",
      description:
        "Visao operacional das guildas licenciadas e do ownership real mantido em `auth_user_plan_guilds`.",
    },
  ],
  [
    "/admin/billing",
    {
      eyebrow: "Financeiro",
      title: "Billing",
      description:
        "Estado atual de planos, vigencia e meios de pagamento persistidos no backend oficial da Flowdesk.",
    },
  ],
  [
    "/admin/payments",
    {
      eyebrow: "Financeiro",
      title: "Pagamentos",
      description:
        "Janela operacional de ordens reais com estado do provedor, metodo, plano e valor transacionado.",
    },
  ],
  [
    "/admin/customers",
    {
      eyebrow: "Operacao",
      title: "Clientes",
      description:
        "Carteira operacional das contas com atividade comercial, plano ou suporte sem duplicar a base de usuarios.",
    },
  ],
  [
    "/admin/users",
    {
      eyebrow: "Operacao",
      title: "Usuarios",
      description:
        "Leitura institucional das contas do auth principal com contexto de plano, tickets e atividade financeira.",
    },
  ],
  [
    "/admin/test-variables/approvals",
    {
      eyebrow: "Dev Environment",
      title: "Aprovacoes FLWIP",
      description:
        "Aprove, rejeite e rastreie credenciamentos de IP com emissao segura de grant e certificado FLWIP.",
    },
  ],
  [
    "/admin/test-variables/certificates",
    {
      eyebrow: "Dev Environment",
      title: "Certificados FLWIP",
      description:
        "Monitore emissao, expiracao, ultimo uso e revogacao dos certificados ativos do ambiente de desenvolvimento.",
    },
  ],
  [
    "/admin/test-variables/logs",
    {
      eyebrow: "Dev Environment",
      title: "Logs de Test Variables",
      description:
        "Timeline auditavel de pulls autorizados ou bloqueados com contexto de projeto, ambiente e resultado.",
    },
  ],
  [
    "/admin/test-variables",
    {
      eyebrow: "Dev Environment",
      title: "Test Variables",
      description:
        "Gerencie projetos, grupos e variaveis criptografadas usadas no desenvolvimento interno com grants e leitura auditada.",
    },
  ],
  [
    "/admin/team",
    {
      eyebrow: "Governanca interna",
      title: "Equipe Administrativa",
      description:
        "Visualize membros internos, departamentos, cargos ativos e o alcance efetivo de permissao sobre a camada institucional da Flowdesk.",
    },
  ],
  [
    "/admin/roles",
    {
      eyebrow: "RBAC institucional",
      title: "Cargos e Hierarquia",
      description:
        "Acompanhe cargos singleton, distribuicao por departamento e a composicao atual de permission sets para a operacao interna.",
    },
  ],
  [
    "/admin/permissions",
    {
      eyebrow: "RBAC institucional",
      title: "Permissoes",
      description:
        "Mapa granular das capacidades administrativas, modulos atendidos e cargos que hoje recebem cada permissao do catalogo.",
    },
  ],
  [
    "/admin/audit",
    {
      eyebrow: "Confianca operacional",
      title: "Auditoria",
      description:
        "Timeline administrativa com foco em rastreabilidade, risco e trilha de execucao para acoes sensiveis da camada interna.",
    },
  ],
  [
    "/admin",
    {
      eyebrow: "Flowdesk Internal",
      title: "Painel Administrativo",
      description:
        "Acompanhe a operacao institucional, pendencias internas e o estado dos sistemas reais da Flowdesk em um unico lugar.",
    },
  ],
];

export function resolveAdminPageMeta(pathname: string): AdminPageMeta {
  const normalizedPath = pathname !== "/" && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;

  const matched =
    ADMIN_PAGE_META_BY_PATH.find(([path]) =>
      normalizedPath === path || normalizedPath.startsWith(`${path}/`),
    ) || ADMIN_PAGE_META_BY_PATH[0];

  return matched[1];
}
