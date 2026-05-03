# Security Notes

## O Que Nunca Fazer

- nao mover service role para client components
- nao expor segredo completo no frontend
- nao persistir test variables em texto puro
- nao liberar producao no fluxo de test variables sem endurecimento extra
- nao confiar apenas em IP sem autenticacao e certificado

## Como Os Segredos Sao Protegidos

- FlowSecure cifra valores sensiveis no servidor
- o painel mostra apenas valor mascarado
- o CLI recebe somente o que o backend autoriza para aquele grant
- o pacote npm nao carrega segredo embutido

## Logs

Auditoria administrativa:

- `admin_audit_logs`

Telemetria de seguranca:

- `auth_security_events`

Leituras de test variables:

- `test_variable_read_logs`

## Revogacao

Revogar acesso significa atuar sobre:

- role/permission
- grant
- allowlist
- certificado FLWIP

Os endpoints administrativos de revoke/approve registram auditoria no backend.

## Rotacao

Rotacao de variavel:

- `PATCH /api/admin/test-variables/:id` com `rotate: true`
- valor antigo nao e exibido no frontend
- `rotated_at` e atualizado

## Producao

O sistema entregue foi deliberadamente fechado para:

- `test`
- `staging`
- `sandbox`

Motivo:

- reduzir blast radius
- separar operacao interna de credenciais de producao
- exigir uma fase futura de aprovacao reforcada para secrets criticos
