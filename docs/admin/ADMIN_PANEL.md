# Admin Panel

## Estrutura

O painel administrativo vive em `app/admin/*` e usa o mesmo shell visual da Flowdesk:

- `components/admin/AdminShell.tsx`
- `components/admin/AdminSidebar.tsx`
- `components/admin/AdminTopbar.tsx`
- `components/admin/AdminPageHeader.tsx`
- `components/admin/AdminDataTable.tsx`
- `components/admin/AdminStatCard.tsx`

Rotas ativas:

- `/admin`
- `/admin/team`
- `/admin/roles`
- `/admin/permissions`
- `/admin/users`
- `/admin/customers`
- `/admin/servers`
- `/admin/domains`
- `/admin/hosting`
- `/admin/payments`
- `/admin/billing`
- `/admin/support`
- `/admin/status`
- `/admin/security`
- `/admin/flowai`
- `/admin/test-variables`
- `/admin/test-variables/approvals`
- `/admin/test-variables/certificates`
- `/admin/test-variables/logs`
- `/admin/audit`
- `/admin/settings`

## Como Acessar

Requisitos obrigatorios:

- sessao autenticada no auth principal
- `admin_staff_profiles.status = active` ou bootstrap valido
- permissao `admin.access`
- permissao especifica do modulo

Protecao server-side:

- `lib/admin/auth.ts`
- `lib/admin/permissions.ts`
- `lib/admin/audit.ts`
- `lib/admin/manage.ts`

Todas as paginas `app/admin/*` e todos os endpoints `app/api/admin/*` validam permissao no backend.

## Modulos

Governanca:

- equipe, cargos, permissoes, auditoria

Operacao:

- usuarios, clientes, pagamentos, billing, servidores, dominios, hospedagem, suporte, status, seguranca, FlowAI

Developer Environment:

- test variables
- aprovacoes FLWIP
- certificados
- logs de leitura

## Observacoes de Escopo

Os modulos operacionais usam dados reais das tabelas e servicos ja existentes. Onde o repositorio ja tinha superficie madura de leitura, o painel entrou completo em modo observabilidade. Onde nao existia mutacao segura pronta, a primeira versao ficou read-first para evitar duplicar dominio ou criar acao administrativa insegura.
