# RBAC

## Modelo

O modelo institucional implementado e:

- `auth_users`
- `admin_staff_profiles`
- `admin_staff_role_assignments`
- `admin_roles`
- `admin_role_permissions`
- `admin_permissions`

O cargo nao concede acesso por nome hardcoded. O backend resolve permissoes efetivas a partir da composicao cargo -> permission set.

## Tabelas

- `admin_staff_profiles`
- `admin_roles`
- `admin_permissions`
- `admin_role_permissions`
- `admin_staff_role_assignments`
- `admin_audit_logs`
- `admin_sessions`
- `admin_action_approvals`

## Cargos Singleton

Singletons ativos:

- `ceo`
- `coo`
- `cto`
- `cfo`

Regras:

- so pode existir um assignment ativo por cargo singleton
- transferencia segura usa `transferSingletonAdminRole`
- atribuicao simples bloqueia ocupacao dupla
- toda troca gera auditoria `critical`

## Helpers Server-Side

- `requireAdminAccess()`
- `requirePermission(permission)`
- `getCurrentAdminProfile()`
- `can(permission)`
- `assertCan(permission)`
- `logAdminAction(...)`

Arquivos:

- `lib/admin/auth.ts`
- `lib/admin/permissions.ts`
- `lib/admin/roles.ts`
- `lib/admin/audit.ts`
- `lib/admin/manage.ts`

## Bootstrap do Primeiro CEO

Variavel usada:

- `FLOWDESK_BOOTSTRAP_ADMIN_EMAIL`

Fluxo:

1. configure `FLOWDESK_BOOTSTRAP_ADMIN_EMAIL`
2. autentique a conta correspondente no auth principal
3. o helper de auth administrativo reconhece o bootstrap apenas enquanto nao houver CEO ativo
4. depois do primeiro CEO atribuido, o bootstrap deixa de valer como caminho normal de acesso

## Auditoria

Acoes sensiveis gravadas em `admin_audit_logs`:

- atribuicao de cargo
- revogacao de cargo
- transferencia de singleton
- mudanca de status de staff
- alteracao de descricao de cargo
- alteracao de permission set
- alteracao de descricao de permissao
- aprovacoes FLWIP e revogacoes
