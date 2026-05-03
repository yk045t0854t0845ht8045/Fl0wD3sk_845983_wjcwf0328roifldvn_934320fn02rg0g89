import {
  ALL_ADMIN_PERMISSION_CODES,
  type AdminPermissionCode,
} from "@/lib/admin/permissions";

export type AdminDepartmentCode =
  | "executive"
  | "operations"
  | "development"
  | "infrastructure"
  | "ai_bots"
  | "support"
  | "finance"
  | "sales"
  | "marketing"
  | "security"
  | "administrative_hr"
  | "community";

export type AdminRoleDefinition = {
  code: string;
  name: string;
  department: AdminDepartmentCode;
  description: string;
  isSingleton: boolean;
  hierarchyLevel: number;
  initialPermissions: AdminPermissionCode[];
};

const ADMIN_BASE: AdminPermissionCode[] = [
  "admin.access",
  "admin.overview.read",
];

const TEAM_ADMIN: AdminPermissionCode[] = [
  "team.read",
  "team.create",
  "team.update",
  "team.disable",
  "team.assign_role",
];

const RBAC_ADMIN: AdminPermissionCode[] = [
  "roles.read",
  "roles.create",
  "roles.update",
  "roles.delete",
  "roles.assign_permissions",
  "permissions.read",
  "permissions.update",
];

const USER_ADMIN: AdminPermissionCode[] = [
  "users.read",
  "users.update",
  "customers.read",
  "customers.update",
  "customers.support_read",
];

const EXECUTIVE_FINANCE: AdminPermissionCode[] = [
  "payments.read",
  "payments.refund",
  "payments.reconcile",
  "payments.export",
  "billing.read",
  "billing.update",
  "billing.charge",
  "billing.cancel_subscription",
];

const OPERATIONS_SURFACE: AdminPermissionCode[] = [
  "servers.read",
  "servers.update",
  "servers.restart",
  "servers.suspend",
  "domains.read",
  "domains.update",
  "hosting.read",
  "hosting.update",
  "support.read",
  "support.reply",
  "support.assign",
  "support.close",
  "support.escalate",
  "status.read",
  "status.create_incident",
  "status.update_incident",
  "status.resolve_incident",
];

const TECH_SURFACE: AdminPermissionCode[] = [
  "servers.read",
  "servers.create",
  "servers.update",
  "servers.restart",
  "servers.suspend",
  "domains.read",
  "domains.create",
  "domains.update",
  "hosting.read",
  "hosting.update",
  "hosting.provision",
  "hosting.suspend",
  "flowai.read",
  "flowai.manage_usage",
  "flowai.view_logs",
];

const SECURITY_SURFACE: AdminPermissionCode[] = [
  "security.read",
  "security.audit_read",
  "security.rate_limits_manage",
  "security.sessions_revoke",
  "security.incidents_manage",
  "audit.read",
  "audit.export",
];

const TEST_VARIABLES_ADMIN: AdminPermissionCode[] = [
  "test_variables.read",
  "test_variables.read_sensitive",
  "test_variables.create",
  "test_variables.update",
  "test_variables.delete",
  "test_variables.request_access",
  "test_variables.approve_access",
  "test_variables.revoke_access",
  "test_variables.manage_ip",
  "test_variables.approve_ip",
  "test_variables.issue_flwip",
  "test_variables.revoke_flwip",
  "test_variables.view_logs",
];

const DEV_PORTAL_BASE: AdminPermissionCode[] = [
  "test_variables.request_access",
  "test_variables.read",
];

const DEV_PORTAL_SENSITIVE: AdminPermissionCode[] = [
  ...DEV_PORTAL_BASE,
  "test_variables.read_sensitive",
];

const SUPPORT_ADMIN: AdminPermissionCode[] = [
  ...ADMIN_BASE,
  "support.read",
  "support.reply",
  "support.assign",
  "support.close",
  "support.escalate",
  "customers.read",
  "customers.support_read",
  "audit.read",
];

const FINANCE_ADMIN: AdminPermissionCode[] = [
  ...ADMIN_BASE,
  "payments.read",
  "payments.export",
  "billing.read",
  "customers.read",
  "users.read",
];

const FINANCE_MANAGER: AdminPermissionCode[] = [
  ...FINANCE_ADMIN,
  "payments.refund",
  "payments.reconcile",
  "billing.update",
  "billing.charge",
  "billing.cancel_subscription",
  "audit.read",
];

const MARKETING_ADMIN: AdminPermissionCode[] = [
  ...ADMIN_BASE,
  "customers.read",
];

const SECURITY_ADMIN: AdminPermissionCode[] = [
  ...ADMIN_BASE,
  ...SECURITY_SURFACE,
  "users.read",
  "users.suspend",
  "team.read",
  "test_variables.manage_ip",
  "test_variables.approve_ip",
  "test_variables.issue_flwip",
  "test_variables.revoke_flwip",
  "test_variables.view_logs",
];

function uniquePermissions(values: AdminPermissionCode[]) {
  return Array.from(new Set(values)) as AdminPermissionCode[];
}

const FULL_EXECUTIVE_PERMISSIONS = uniquePermissions([
  ...ALL_ADMIN_PERMISSION_CODES,
]);

export const ADMIN_ROLE_DEFINITIONS = [
  {
    code: "ceo",
    name: "Dono / CEO",
    department: "executive",
    description: "Responsável máximo pela operação institucional da Flowdesk.",
    isSingleton: true,
    hierarchyLevel: 100,
    initialPermissions: FULL_EXECUTIVE_PERMISSIONS,
  },
  {
    code: "coo",
    name: "Diretor Executivo / COO",
    department: "executive",
    description: "Coordena a operação institucional e fluxos executivos.",
    isSingleton: true,
    hierarchyLevel: 95,
    initialPermissions: uniquePermissions([
      ...FULL_EXECUTIVE_PERMISSIONS,
    ]),
  },
  {
    code: "cto",
    name: "Diretor Técnico / CTO",
    department: "executive",
    description: "Conduz arquitetura, engenharia, segurança e infraestrutura.",
    isSingleton: true,
    hierarchyLevel: 94,
    initialPermissions: uniquePermissions([
      ...ADMIN_BASE,
      ...TEAM_ADMIN,
      ...RBAC_ADMIN,
      ...USER_ADMIN,
      ...TECH_SURFACE,
      ...SECURITY_SURFACE,
      ...TEST_VARIABLES_ADMIN,
      "support.read",
      "status.read",
      "status.create_incident",
      "status.update_incident",
      "status.resolve_incident",
      "flowai.manage_keys",
      "users.suspend",
      "users.impersonate_safe",
      "settings.read",
      "settings.update",
      "payments.read",
      "billing.read",
      "team.transfer_singleton_role",
    ]),
  },
  {
    code: "cfo",
    name: "Diretor Financeiro / CFO",
    department: "executive",
    description: "Conduz cobrança, pagamentos, risco financeiro e compliance.",
    isSingleton: true,
    hierarchyLevel: 93,
    initialPermissions: uniquePermissions([
      ...ADMIN_BASE,
      ...TEAM_ADMIN,
      "team.transfer_singleton_role",
      ...USER_ADMIN,
      ...EXECUTIVE_FINANCE,
      ...SECURITY_SURFACE,
      "support.read",
      "audit.read",
      "settings.read",
    ]),
  },
  {
    code: "general_manager",
    name: "Gerente Geral",
    department: "operations",
    description: "Coordena áreas internas e operação diária.",
    isSingleton: false,
    hierarchyLevel: 85,
    initialPermissions: uniquePermissions([
      ...ADMIN_BASE,
      ...TEAM_ADMIN,
      "roles.read",
      "permissions.read",
      ...USER_ADMIN,
      ...OPERATIONS_SURFACE,
      "payments.read",
      "billing.read",
      "security.read",
      "audit.read",
      "settings.read",
    ]),
  },
  {
    code: "operations_manager",
    name: "Gerente de Operações",
    department: "operations",
    description: "Coordena suporte, status operacional e fluxo diário de execução.",
    isSingleton: false,
    hierarchyLevel: 82,
    initialPermissions: uniquePermissions([
      ...ADMIN_BASE,
      "team.read",
      ...USER_ADMIN,
      ...OPERATIONS_SURFACE,
      "security.read",
      "audit.read",
    ]),
  },
  {
    code: "development_manager",
    name: "Gerente de Desenvolvimento",
    department: "development",
    description: "Lidera a equipe de desenvolvimento e acesso técnico interno.",
    isSingleton: false,
    hierarchyLevel: 80,
    initialPermissions: uniquePermissions([
      ...ADMIN_BASE,
      "team.read",
      "team.assign_role",
      "roles.read",
      "permissions.read",
      "users.read",
      ...TECH_SURFACE,
      "status.read",
      ...TEST_VARIABLES_ADMIN,
      "audit.read",
    ]),
  },
  {
    code: "development_lead",
    name: "Líder de Desenvolvimento",
    department: "development",
    description: "Conduz liderança técnica e liberações de desenvolvimento.",
    isSingleton: false,
    hierarchyLevel: 76,
    initialPermissions: uniquePermissions([
      ...ADMIN_BASE,
      "team.read",
      "roles.read",
      "permissions.read",
      "users.read",
      "servers.read",
      "servers.update",
      "domains.read",
      "hosting.read",
      "flowai.read",
      "flowai.manage_usage",
      ...TEST_VARIABLES_ADMIN,
      "audit.read",
    ]),
  },
  {
    code: "developer_senior",
    name: "Desenvolvedor Sênior",
    department: "development",
    description: "Executa trabalho técnico avançado e consome ambientes autorizados.",
    isSingleton: false,
    hierarchyLevel: 70,
    initialPermissions: uniquePermissions([
      ...DEV_PORTAL_SENSITIVE,
      "flowai.read",
      "servers.read",
      "domains.read",
      "hosting.read",
    ]),
  },
  {
    code: "developer_mid",
    name: "Desenvolvedor Pleno",
    department: "development",
    description: "Executa trabalho técnico e solicita ambientes dev autorizados.",
    isSingleton: false,
    hierarchyLevel: 64,
    initialPermissions: uniquePermissions([
      ...DEV_PORTAL_BASE,
      "flowai.read",
      "servers.read",
      "domains.read",
    ]),
  },
  {
    code: "developer_junior",
    name: "Desenvolvedor Júnior",
    department: "development",
    description: "Acessa ambientes internos com grants explícitos.",
    isSingleton: false,
    hierarchyLevel: 58,
    initialPermissions: uniquePermissions([
      ...DEV_PORTAL_BASE,
    ]),
  },
  {
    code: "infrastructure_manager",
    name: "Gerente de Infraestrutura",
    department: "infrastructure",
    description: "Coordena hospedagem, infraestrutura e segurança operacional.",
    isSingleton: false,
    hierarchyLevel: 79,
    initialPermissions: uniquePermissions([
      ...ADMIN_BASE,
      "team.read",
      "users.read",
      "servers.read",
      "servers.update",
      "servers.restart",
      "servers.suspend",
      "hosting.read",
      "hosting.update",
      "hosting.provision",
      "hosting.suspend",
      "domains.read",
      ...TEST_VARIABLES_ADMIN,
      ...SECURITY_SURFACE,
      "audit.read",
    ]),
  },
  {
    code: "infra_lead",
    name: "Líder de Infra",
    department: "infrastructure",
    description: "Conduz execução técnica de infraestrutura e operação.",
    isSingleton: false,
    hierarchyLevel: 73,
    initialPermissions: uniquePermissions([
      ...ADMIN_BASE,
      "servers.read",
      "servers.update",
      "servers.restart",
      "hosting.read",
      "hosting.update",
      "hosting.provision",
      "domains.read",
      ...TEST_VARIABLES_ADMIN,
      "security.read",
      "audit.read",
    ]),
  },
  {
    code: "infra_engineer",
    name: "Engenheiro de Infra / SysAdmin",
    department: "infrastructure",
    description: "Opera infraestrutura, rede e ambientes internos.",
    isSingleton: false,
    hierarchyLevel: 67,
    initialPermissions: uniquePermissions([
      "servers.read",
      "servers.update",
      "servers.restart",
      "hosting.read",
      "hosting.update",
      "domains.read",
      ...DEV_PORTAL_SENSITIVE,
      "test_variables.manage_ip",
      "test_variables.view_logs",
      "security.read",
    ]),
  },
  {
    code: "infra_technician",
    name: "Técnico de Infra",
    department: "infrastructure",
    description: "Atua em rotinas operacionais de infraestrutura.",
    isSingleton: false,
    hierarchyLevel: 55,
    initialPermissions: uniquePermissions([
      "servers.read",
      "hosting.read",
      "domains.read",
      ...DEV_PORTAL_BASE,
    ]),
  },
  {
    code: "ai_bots_lead",
    name: "Líder de IA / Bots",
    department: "ai_bots",
    description: "Coordena iniciativas de IA, automação e bots.",
    isSingleton: false,
    hierarchyLevel: 74,
    initialPermissions: uniquePermissions([
      ...ADMIN_BASE,
      "users.read",
      "servers.read",
      "flowai.read",
      "flowai.manage_keys",
      "flowai.manage_usage",
      "flowai.view_logs",
      ...DEV_PORTAL_SENSITIVE,
      "test_variables.view_logs",
      "audit.read",
    ]),
  },
  {
    code: "ai_specialist",
    name: "Especialista em IA",
    department: "ai_bots",
    description: "Opera chaves, uso e integração técnica da FlowAI.",
    isSingleton: false,
    hierarchyLevel: 66,
    initialPermissions: uniquePermissions([
      "flowai.read",
      "flowai.manage_usage",
      "flowai.view_logs",
      ...DEV_PORTAL_SENSITIVE,
    ]),
  },
  {
    code: "bot_developer",
    name: "Desenvolvedor de Bots",
    department: "ai_bots",
    description: "Desenvolve bots e consome ambientes dev autorizados.",
    isSingleton: false,
    hierarchyLevel: 61,
    initialPermissions: uniquePermissions([
      "flowai.read",
      ...DEV_PORTAL_BASE,
    ]),
  },
  {
    code: "support_manager",
    name: "Gerente de Suporte",
    department: "support",
    description: "Coordena atendimento, escalonamento e qualidade de suporte.",
    isSingleton: false,
    hierarchyLevel: 72,
    initialPermissions: uniquePermissions([
      ...SUPPORT_ADMIN,
      "team.read",
      "team.update",
    ]),
  },
  {
    code: "support_supervisor",
    name: "Supervisor de Suporte",
    department: "support",
    description: "Supervisiona atendimento e filas de suporte.",
    isSingleton: false,
    hierarchyLevel: 65,
    initialPermissions: uniquePermissions([
      ...SUPPORT_ADMIN,
    ]),
  },
  {
    code: "support_level_2",
    name: "Atendente Suporte Nível 2",
    department: "support",
    description: "Executa suporte técnico avançado.",
    isSingleton: false,
    hierarchyLevel: 54,
    initialPermissions: uniquePermissions([
      "support.read",
      "support.reply",
      "support.assign",
      "support.close",
      "customers.read",
      "customers.support_read",
    ]),
  },
  {
    code: "support_level_1",
    name: "Atendente Suporte Nível 1",
    department: "support",
    description: "Executa atendimento inicial e triagem.",
    isSingleton: false,
    hierarchyLevel: 48,
    initialPermissions: uniquePermissions([
      "support.read",
      "support.reply",
      "customers.read",
      "customers.support_read",
    ]),
  },
  {
    code: "finance_manager",
    name: "Gerente Financeiro",
    department: "finance",
    description: "Coordena cobrança, conciliação e operação financeira.",
    isSingleton: false,
    hierarchyLevel: 71,
    initialPermissions: uniquePermissions([
      ...FINANCE_MANAGER,
    ]),
  },
  {
    code: "finance_analyst",
    name: "Analista Financeiro",
    department: "finance",
    description: "Opera conciliação, relatórios e análise financeira.",
    isSingleton: false,
    hierarchyLevel: 60,
    initialPermissions: uniquePermissions([
      ...FINANCE_ADMIN,
      "payments.reconcile",
      "billing.update",
      "audit.read",
    ]),
  },
  {
    code: "collections_owner",
    name: "Responsável por Cobrança",
    department: "finance",
    description: "Executa rotinas de cobrança e cancelamento operacional.",
    isSingleton: false,
    hierarchyLevel: 56,
    initialPermissions: uniquePermissions([
      ...FINANCE_ADMIN,
      "billing.update",
      "billing.charge",
      "billing.cancel_subscription",
    ]),
  },
  {
    code: "finance_assistant",
    name: "Assistente Financeiro",
    department: "finance",
    description: "Apoia operação financeira diária.",
    isSingleton: false,
    hierarchyLevel: 46,
    initialPermissions: uniquePermissions([
      ...FINANCE_ADMIN,
    ]),
  },
  {
    code: "sales_manager",
    name: "Gerente Comercial",
    department: "sales",
    description: "Coordena operação comercial e carteira de clientes.",
    isSingleton: false,
    hierarchyLevel: 68,
    initialPermissions: uniquePermissions([
      ...ADMIN_BASE,
      "customers.read",
      "customers.update",
      "payments.read",
      "billing.read",
      "support.read",
    ]),
  },
  {
    code: "sales_supervisor",
    name: "Supervisor de Vendas",
    department: "sales",
    description: "Supervisiona execução comercial.",
    isSingleton: false,
    hierarchyLevel: 57,
    initialPermissions: uniquePermissions([
      ...ADMIN_BASE,
      "customers.read",
      "payments.read",
      "billing.read",
    ]),
  },
  {
    code: "sales_representative",
    name: "Vendedor",
    department: "sales",
    description: "Atua no acompanhamento comercial de clientes.",
    isSingleton: false,
    hierarchyLevel: 45,
    initialPermissions: uniquePermissions([
      "customers.read",
      "billing.read",
    ]),
  },
  {
    code: "marketing_manager",
    name: "Gerente de Marketing",
    department: "marketing",
    description: "Coordena campanhas e aquisição.",
    isSingleton: false,
    hierarchyLevel: 62,
    initialPermissions: uniquePermissions([
      ...MARKETING_ADMIN,
      "payments.read",
      "billing.read",
    ]),
  },
  {
    code: "social_media",
    name: "Social Media",
    department: "marketing",
    description: "Opera canais de mídia e campanhas sociais.",
    isSingleton: false,
    hierarchyLevel: 40,
    initialPermissions: uniquePermissions([
      ...MARKETING_ADMIN,
    ]),
  },
  {
    code: "designer",
    name: "Designer",
    department: "marketing",
    description: "Produz peças visuais e assets institucionais.",
    isSingleton: false,
    hierarchyLevel: 39,
    initialPermissions: uniquePermissions([
      ...MARKETING_ADMIN,
    ]),
  },
  {
    code: "copywriter",
    name: "Copywriter",
    department: "marketing",
    description: "Produz conteúdo e comunicação escrita.",
    isSingleton: false,
    hierarchyLevel: 38,
    initialPermissions: uniquePermissions([
      ...MARKETING_ADMIN,
    ]),
  },
  {
    code: "security_specialist",
    name: "Especialista em Segurança",
    department: "security",
    description: "Conduz resposta, auditoria e endurecimento de segurança.",
    isSingleton: false,
    hierarchyLevel: 69,
    initialPermissions: uniquePermissions([
      ...SECURITY_ADMIN,
      "test_variables.read_sensitive",
    ]),
  },
  {
    code: "security_analyst",
    name: "Analista de Segurança",
    department: "security",
    description: "Monitora eventos, acessos e comportamento de risco.",
    isSingleton: false,
    hierarchyLevel: 59,
    initialPermissions: uniquePermissions([
      ...SECURITY_ADMIN,
      "test_variables.view_logs",
    ]),
  },
  {
    code: "administrative_manager",
    name: "Gerente Administrativo",
    department: "administrative_hr",
    description: "Coordena administração interna e governança de pessoas.",
    isSingleton: false,
    hierarchyLevel: 63,
    initialPermissions: uniquePermissions([
      ...ADMIN_BASE,
      ...TEAM_ADMIN,
      "roles.read",
      "permissions.read",
      "users.read",
      "customers.read",
      "audit.read",
      "settings.read",
    ]),
  },
  {
    code: "hr",
    name: "RH",
    department: "administrative_hr",
    description: "Opera gestão de pessoas e cadastro interno.",
    isSingleton: false,
    hierarchyLevel: 53,
    initialPermissions: uniquePermissions([
      ...ADMIN_BASE,
      "team.read",
      "team.create",
      "team.update",
      "users.read",
      "audit.read",
    ]),
  },
  {
    code: "administrative_assistant",
    name: "Assistente Administrativo",
    department: "administrative_hr",
    description: "Apoia rotinas administrativas internas.",
    isSingleton: false,
    hierarchyLevel: 41,
    initialPermissions: uniquePermissions([
      "team.read",
      "users.read",
      "customers.read",
    ]),
  },
  {
    code: "community_moderator",
    name: "Moderador Discord/Comunidade",
    department: "community",
    description: "Opera moderação e relacionamento de comunidade.",
    isSingleton: false,
    hierarchyLevel: 37,
    initialPermissions: uniquePermissions([
      "customers.read",
      "support.read",
      "support.reply",
    ]),
  },
  {
    code: "qa_tester",
    name: "Tester / QA",
    department: "community",
    description: "Valida fluxos e consome ambientes de teste autorizados.",
    isSingleton: false,
    hierarchyLevel: 36,
    initialPermissions: uniquePermissions([
      ...DEV_PORTAL_BASE,
    ]),
  },
  {
    code: "intern",
    name: "Estagiário",
    department: "community",
    description: "Acesso inicial limitado a atividades supervisionadas.",
    isSingleton: false,
    hierarchyLevel: 20,
    initialPermissions: uniquePermissions([
      "test_variables.request_access",
    ]),
  },
] as const satisfies readonly AdminRoleDefinition[];

export type AdminRoleCode = (typeof ADMIN_ROLE_DEFINITIONS)[number]["code"];

export const ADMIN_ROLE_BY_CODE: ReadonlyMap<string, AdminRoleDefinition> = new Map(
  ADMIN_ROLE_DEFINITIONS.map((role) => [role.code, role]),
);

export const ADMIN_ROLE_CODES: ReadonlySet<string> = new Set<string>(
  ADMIN_ROLE_DEFINITIONS.map((role) => role.code),
);

export function getAdminRoleDefinition(code: string) {
  return ADMIN_ROLE_BY_CODE.get(code) || null;
}

export function isAdminRoleCode(value: string): value is AdminRoleCode {
  return ADMIN_ROLE_CODES.has(value);
}
