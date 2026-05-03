# FLWIP

## O Que E

FLWIP e o certificado operacional que vincula:

- usuario interno autenticado
- projeto
- ambiente
- IP aprovado
- escopo de acesso
- expiracao

## Fluxo

1. o dev autentica via `flw login`
2. a web aprova a tentativa de login do CLI
3. o dev solicita credenciamento de IP em `/account/dev-environment`
4. o admin aprova em `/admin/test-variables/approvals`
5. o backend cria:
   - grant
   - allowlist
   - certificado FLWIP
6. o CLI usa esse contexto em `flw env pull` ou `flw dev --`

## Tabelas

- `dev_ip_requests`
- `dev_ip_allowlist`
- `dev_certificates`
- `dev_login_attempts`
- `dev_auth_tokens`

## Endpoints

- `POST /api/dev-auth/login/start`
- `POST /api/dev-auth/login/complete`
- `GET /api/dev/me`
- `GET /api/dev/ip/status`
- `POST /api/dev/ip/request`

Admin:

- `GET /api/admin/test-variables/approvals`
- `POST /api/admin/test-variables/ip-requests/:id/approve`
- `POST /api/admin/test-variables/ip-requests/:id/reject`
- `POST /api/admin/test-variables/certificates/:id/revoke`

## Revogacao e Expiracao

Um pull e bloqueado quando:

- o IP nao esta aprovado
- o grant expirou
- o certificado expirou
- o certificado foi revogado
- o usuario perdeu permissao
- o projeto/ambiente nao fazem parte do grant

Toda aprovacao, revogacao e tentativa de leitura fica auditada.
