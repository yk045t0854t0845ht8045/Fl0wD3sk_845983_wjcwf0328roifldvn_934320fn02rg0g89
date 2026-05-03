export type AdminRiskLevel = "low" | "medium" | "high" | "critical";

export type AdminPermissionDefinition = {
  code: string;
  description: string;
  riskLevel: AdminRiskLevel;
  module: string;
};

export const ADMIN_PERMISSION_DEFINITIONS = [
  {
    code: "admin.access",
    description: "Permite acessar o painel administrativo institucional.",
    riskLevel: "medium",
    module: "admin",
  },
  {
    code: "admin.overview.read",
    description: "Permite visualizar a visão geral administrativa.",
    riskLevel: "low",
    module: "admin",
  },
  {
    code: "team.read",
    description: "Permite listar perfis internos e equipe administrativa.",
    riskLevel: "low",
    module: "team",
  },
  {
    code: "team.create",
    description: "Permite criar perfis internos e entradas de staff.",
    riskLevel: "medium",
    module: "team",
  },
  {
    code: "team.update",
    description: "Permite editar perfis internos e dados organizacionais.",
    riskLevel: "medium",
    module: "team",
  },
  {
    code: "team.disable",
    description: "Permite desativar ou suspender membros internos.",
    riskLevel: "high",
    module: "team",
  },
  {
    code: "team.assign_role",
    description: "Permite atribuir ou remover cargos administrativos.",
    riskLevel: "high",
    module: "team",
  },
  {
    code: "team.transfer_singleton_role",
    description: "Permite transferir cargos únicos institucionais.",
    riskLevel: "critical",
    module: "team",
  },
  {
    code: "roles.read",
    description: "Permite visualizar cargos administrativos.",
    riskLevel: "low",
    module: "roles",
  },
  {
    code: "roles.create",
    description: "Permite criar cargos administrativos.",
    riskLevel: "high",
    module: "roles",
  },
  {
    code: "roles.update",
    description: "Permite editar cargos administrativos.",
    riskLevel: "high",
    module: "roles",
  },
  {
    code: "roles.delete",
    description: "Permite remover cargos administrativos.",
    riskLevel: "critical",
    module: "roles",
  },
  {
    code: "roles.assign_permissions",
    description: "Permite alterar conjuntos de permissões de cargos.",
    riskLevel: "critical",
    module: "roles",
  },
  {
    code: "permissions.read",
    description: "Permite listar permissões administrativas.",
    riskLevel: "low",
    module: "permissions",
  },
  {
    code: "permissions.update",
    description: "Permite editar metadados de permissões administrativas.",
    riskLevel: "high",
    module: "permissions",
  },
  {
    code: "users.read",
    description: "Permite listar contas Flowdesk.",
    riskLevel: "low",
    module: "users",
  },
  {
    code: "users.update",
    description: "Permite atualizar dados administrativos de contas.",
    riskLevel: "high",
    module: "users",
  },
  {
    code: "users.suspend",
    description: "Permite suspender contas quando suportado.",
    riskLevel: "critical",
    module: "users",
  },
  {
    code: "users.impersonate_safe",
    description: "Permite impersonação segura quando explicitamente suportada.",
    riskLevel: "critical",
    module: "users",
  },
  {
    code: "customers.read",
    description: "Permite listar clientes e contas pagantes.",
    riskLevel: "low",
    module: "customers",
  },
  {
    code: "customers.update",
    description: "Permite atualizar dados operacionais de clientes.",
    riskLevel: "high",
    module: "customers",
  },
  {
    code: "customers.support_read",
    description: "Permite visualizar histórico de suporte de clientes.",
    riskLevel: "medium",
    module: "customers",
  },
  {
    code: "servers.read",
    description: "Permite listar servidores/licenças gerenciadas.",
    riskLevel: "low",
    module: "servers",
  },
  {
    code: "servers.create",
    description: "Permite registrar novas entradas administrativas de servidor.",
    riskLevel: "medium",
    module: "servers",
  },
  {
    code: "servers.update",
    description: "Permite editar dados administrativos de servidores.",
    riskLevel: "high",
    module: "servers",
  },
  {
    code: "servers.restart",
    description: "Permite disparar reinícios quando suportados.",
    riskLevel: "high",
    module: "servers",
  },
  {
    code: "servers.suspend",
    description: "Permite suspender servidores quando suportado.",
    riskLevel: "critical",
    module: "servers",
  },
  {
    code: "servers.delete",
    description: "Permite excluir entradas administrativas de servidor.",
    riskLevel: "critical",
    module: "servers",
  },
  {
    code: "domains.read",
    description: "Permite listar domínios e contexto operacional.",
    riskLevel: "low",
    module: "domains",
  },
  {
    code: "domains.create",
    description: "Permite iniciar novas operações administrativas de domínio.",
    riskLevel: "medium",
    module: "domains",
  },
  {
    code: "domains.update",
    description: "Permite atualizar dados administrativos de domínio.",
    riskLevel: "high",
    module: "domains",
  },
  {
    code: "domains.delete",
    description: "Permite cancelar ou excluir operações de domínio.",
    riskLevel: "critical",
    module: "domains",
  },
  {
    code: "hosting.read",
    description: "Permite visualizar a visão operacional de hospedagem.",
    riskLevel: "low",
    module: "hosting",
  },
  {
    code: "hosting.update",
    description: "Permite editar dados operacionais de hospedagem.",
    riskLevel: "high",
    module: "hosting",
  },
  {
    code: "hosting.provision",
    description: "Permite provisionar recursos de hospedagem quando suportado.",
    riskLevel: "high",
    module: "hosting",
  },
  {
    code: "hosting.suspend",
    description: "Permite suspender recursos de hospedagem.",
    riskLevel: "critical",
    module: "hosting",
  },
  {
    code: "payments.read",
    description: "Permite visualizar pagamentos e eventos financeiros.",
    riskLevel: "medium",
    module: "payments",
  },
  {
    code: "payments.refund",
    description: "Permite executar estornos.",
    riskLevel: "critical",
    module: "payments",
  },
  {
    code: "payments.reconcile",
    description: "Permite reconciliar ordens e pagamentos.",
    riskLevel: "high",
    module: "payments",
  },
  {
    code: "payments.export",
    description: "Permite exportar relatórios financeiros.",
    riskLevel: "high",
    module: "payments",
  },
  {
    code: "billing.read",
    description: "Permite visualizar assinaturas e estado de cobrança.",
    riskLevel: "medium",
    module: "billing",
  },
  {
    code: "billing.update",
    description: "Permite editar dados administrativos de cobrança.",
    riskLevel: "high",
    module: "billing",
  },
  {
    code: "billing.charge",
    description: "Permite executar ações de cobrança.",
    riskLevel: "critical",
    module: "billing",
  },
  {
    code: "billing.cancel_subscription",
    description: "Permite cancelar assinaturas.",
    riskLevel: "critical",
    module: "billing",
  },
  {
    code: "support.read",
    description: "Permite visualizar tickets de suporte.",
    riskLevel: "low",
    module: "support",
  },
  {
    code: "support.reply",
    description: "Permite responder tickets quando suportado.",
    riskLevel: "medium",
    module: "support",
  },
  {
    code: "support.assign",
    description: "Permite atribuir tickets a responsáveis.",
    riskLevel: "medium",
    module: "support",
  },
  {
    code: "support.close",
    description: "Permite encerrar tickets.",
    riskLevel: "high",
    module: "support",
  },
  {
    code: "support.escalate",
    description: "Permite escalar tickets de suporte.",
    riskLevel: "high",
    module: "support",
  },
  {
    code: "status.read",
    description: "Permite visualizar status e incidentes.",
    riskLevel: "low",
    module: "status",
  },
  {
    code: "status.create_incident",
    description: "Permite criar incidentes públicos.",
    riskLevel: "high",
    module: "status",
  },
  {
    code: "status.update_incident",
    description: "Permite atualizar incidentes públicos.",
    riskLevel: "high",
    module: "status",
  },
  {
    code: "status.resolve_incident",
    description: "Permite resolver incidentes públicos.",
    riskLevel: "high",
    module: "status",
  },
  {
    code: "flowai.read",
    description: "Permite visualizar sinais, jobs e uso da FlowAI.",
    riskLevel: "medium",
    module: "flowai",
  },
  {
    code: "flowai.manage_keys",
    description: "Permite administrar chaves e credenciais FlowAI.",
    riskLevel: "critical",
    module: "flowai",
  },
  {
    code: "flowai.manage_usage",
    description: "Permite administrar uso e filas da FlowAI.",
    riskLevel: "high",
    module: "flowai",
  },
  {
    code: "flowai.view_logs",
    description: "Permite visualizar logs operacionais da FlowAI.",
    riskLevel: "high",
    module: "flowai",
  },
  {
    code: "security.read",
    description: "Permite visualizar o módulo de segurança.",
    riskLevel: "medium",
    module: "security",
  },
  {
    code: "security.audit_read",
    description: "Permite ler trilhas de auditoria de segurança.",
    riskLevel: "high",
    module: "security",
  },
  {
    code: "security.rate_limits_manage",
    description: "Permite administrar controles de rate limit quando suportados.",
    riskLevel: "critical",
    module: "security",
  },
  {
    code: "security.sessions_revoke",
    description: "Permite revogar sessões.",
    riskLevel: "critical",
    module: "security",
  },
  {
    code: "security.incidents_manage",
    description: "Permite gerenciar incidentes de segurança.",
    riskLevel: "critical",
    module: "security",
  },
  {
    code: "test_variables.read",
    description: "Permite visualizar metadados de variáveis de teste.",
    riskLevel: "medium",
    module: "test_variables",
  },
  {
    code: "test_variables.read_sensitive",
    description: "Permite consumir variáveis sensíveis autorizadas.",
    riskLevel: "critical",
    module: "test_variables",
  },
  {
    code: "test_variables.create",
    description: "Permite criar variáveis de teste.",
    riskLevel: "high",
    module: "test_variables",
  },
  {
    code: "test_variables.update",
    description: "Permite atualizar ou rotacionar variáveis de teste.",
    riskLevel: "high",
    module: "test_variables",
  },
  {
    code: "test_variables.delete",
    description: "Permite desativar ou excluir variáveis de teste.",
    riskLevel: "critical",
    module: "test_variables",
  },
  {
    code: "test_variables.request_access",
    description: "Permite solicitar acesso a ambiente de desenvolvimento/teste.",
    riskLevel: "low",
    module: "test_variables",
  },
  {
    code: "test_variables.approve_access",
    description: "Permite aprovar grants de acesso a variáveis.",
    riskLevel: "critical",
    module: "test_variables",
  },
  {
    code: "test_variables.revoke_access",
    description: "Permite revogar grants de acesso a variáveis.",
    riskLevel: "critical",
    module: "test_variables",
  },
  {
    code: "test_variables.manage_ip",
    description: "Permite gerenciar solicitações e allowlist de IP.",
    riskLevel: "high",
    module: "test_variables",
  },
  {
    code: "test_variables.approve_ip",
    description: "Permite aprovar credenciamento de IP.",
    riskLevel: "critical",
    module: "test_variables",
  },
  {
    code: "test_variables.issue_flwip",
    description: "Permite emitir certificados FLWIP.",
    riskLevel: "critical",
    module: "test_variables",
  },
  {
    code: "test_variables.revoke_flwip",
    description: "Permite revogar certificados FLWIP.",
    riskLevel: "critical",
    module: "test_variables",
  },
  {
    code: "test_variables.view_logs",
    description: "Permite visualizar logs de leitura e validação de variáveis.",
    riskLevel: "high",
    module: "test_variables",
  },
  {
    code: "audit.read",
    description: "Permite visualizar auditoria administrativa.",
    riskLevel: "high",
    module: "audit",
  },
  {
    code: "audit.export",
    description: "Permite exportar auditoria administrativa.",
    riskLevel: "critical",
    module: "audit",
  },
  {
    code: "settings.read",
    description: "Permite visualizar configurações administrativas.",
    riskLevel: "medium",
    module: "settings",
  },
  {
    code: "settings.update",
    description: "Permite atualizar configurações administrativas.",
    riskLevel: "critical",
    module: "settings",
  },
] as const satisfies readonly AdminPermissionDefinition[];

export type AdminPermissionCode =
  (typeof ADMIN_PERMISSION_DEFINITIONS)[number]["code"];

export const ALL_ADMIN_PERMISSION_CODES = ADMIN_PERMISSION_DEFINITIONS.map(
  (permission) => permission.code,
) as AdminPermissionCode[];

export const ADMIN_PERMISSION_CODES: ReadonlySet<string> = new Set<string>(
  ALL_ADMIN_PERMISSION_CODES,
);

export const ADMIN_PERMISSION_BY_CODE: ReadonlyMap<
  string,
  AdminPermissionDefinition
> = new Map(
  ADMIN_PERMISSION_DEFINITIONS.map((permission) => [permission.code, permission]),
);

export function isAdminPermissionCode(value: string): value is AdminPermissionCode {
  return ADMIN_PERMISSION_CODES.has(value);
}

export function getAdminPermissionDefinition(code: string) {
  return ADMIN_PERMISSION_BY_CODE.get(code) || null;
}

export function getAdminPermissionModuleOptions() {
  return Array.from(
    new Set(ADMIN_PERMISSION_DEFINITIONS.map((permission) => permission.module)),
  ).sort((left, right) => left.localeCompare(right, "pt-BR"));
}
