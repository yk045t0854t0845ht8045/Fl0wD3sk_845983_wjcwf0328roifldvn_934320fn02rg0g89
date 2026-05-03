# Test Variables

## Estrutura

O sistema usa:

- `test_variable_projects`
- `test_variable_groups`
- `test_variables`
- `test_variable_access_grants`
- `test_variable_read_logs`

E integra com:

- `dev_ip_requests`
- `dev_ip_allowlist`
- `dev_certificates`
- `dev_login_attempts`
- `dev_auth_tokens`

## Hierarquia

- projeto
- grupo
- variavel

Cada variavel e vinculada a um grupo, e cada grupo pertence a um projeto + ambiente.

Ambientes liberados no MVP:

- `test`
- `staging`
- `sandbox`

## Sensibilidade

- `public`
- `internal`
- `sensitive`
- `critical`

Regras:

- `public`: leitura por dev autorizado ao projeto
- `internal`: exige grant do projeto
- `sensitive`: exige `test_variables.read_sensitive`
- `critical`: pode existir no catalogo, mas nao deve ser liberada casualmente via CLI

## Criptografia

Valores nunca sao persistidos em texto puro.

Implementacao:

- criptografia server-side via FlowSecure
- mascaramento no painel
- decriptacao apenas no backend

Arquivo central:

- `lib/test-variables/service.ts`

## Admin UI

Paginas:

- `/admin/test-variables`
- `/admin/test-variables/approvals`
- `/admin/test-variables/certificates`
- `/admin/test-variables/logs`

## Pull

Endpoint:

- `POST /api/dev/test-variables/pull`

Validacoes:

- token ou sessao valida
- grant do projeto
- IP aprovado
- certificado valido
- permissao suficiente para a sensibilidade solicitada

Toda leitura gera `test_variable_read_logs`.
