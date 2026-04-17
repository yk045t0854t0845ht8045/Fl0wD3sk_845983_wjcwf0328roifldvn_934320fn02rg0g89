# Email Deliverability - `flwdesk.com`

Estado conferido em `2026-04-17`:

- DNS do dominio esta sendo gerenciado fora da Hostinger. O SOA atual aponta para Cloudflare.
- MX atual esta correto para Hostinger:
  - `mx1.hostinger.com` prioridade `5`
  - `mx2.hostinger.com` prioridade `10`
- SPF atual esta correto:
  - `v=spf1 include:_spf.mail.hostinger.com ~all`
- DMARC atual existe, mas esta fraco:
  - `v=DMARC1; p=none`
- DKIM padrao da Hostinger nao foi encontrado no DNS.

## Registros para aplicar no Cloudflare DNS

### MX

| Tipo | Nome | Prioridade | Conteudo | TTL |
| --- | --- | --- | --- | --- |
| MX | `@` | `5` | `mx1.hostinger.com` | Auto |
| MX | `@` | `10` | `mx2.hostinger.com` | Auto |

### SPF

| Tipo | Nome | Conteudo | TTL |
| --- | --- | --- | --- |
| TXT | `@` | `v=spf1 include:_spf.mail.hostinger.com ~all` | Auto |

Observacao:

- Deve existir apenas um SPF no dominio raiz. Se algum outro servico tambem enviar email pelo `@flwdesk.com`, o SPF precisa ser mesclado em uma unica linha.

### DKIM padrao da Hostinger

| Tipo | Nome | Conteudo | TTL |
| --- | --- | --- | --- |
| CNAME | `hostingermail-a._domainkey` | `hostingermail-a.dkim.mail.hostinger.com` | Auto |
| CNAME | `hostingermail-b._domainkey` | `hostingermail-b.dkim.mail.hostinger.com` | Auto |
| CNAME | `hostingermail-c._domainkey` | `hostingermail-c.dkim.mail.hostinger.com` | Auto |

### DMARC recomendado agora

Opcao segura para colocar hoje:

| Tipo | Nome | Conteudo | TTL |
| --- | --- | --- | --- |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; adkim=s; aspf=s; pct=100` | Auto |

Opcao mais forte depois de confirmar tudo funcionando:

| Tipo | Nome | Conteudo | TTL |
| --- | --- | --- | --- |
| TXT | `_dmarc` | `v=DMARC1; p=reject; adkim=s; aspf=s; pct=100` | Auto |

Se quiser receber relatorios DMARC, use:

| Tipo | Nome | Conteudo | TTL |
| --- | --- | --- | --- |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; adkim=s; aspf=s; pct=100; rua=mailto:dmarc@flwdesk.com` | Auto |

## `.env` recomendado para alinhamento

Use o mesmo dominio no remetente visivel e no envelope:

```env
AUTH_SMTP_HOST=smtp.hostinger.com
AUTH_SMTP_PORT=587
AUTH_SMTP_SECURE=false
AUTH_SMTP_USER=<seu-email-hostinger>
AUTH_SMTP_PASS=<sua-senha-smtp>
AUTH_SMTP_FROM_EMAIL=<mesmo-email-do-dominio>
AUTH_SMTP_FROM_NAME=Flowdesk Security
AUTH_SMTP_ENVELOPE_FROM=<mesmo-email-do-dominio>
AUTH_SMTP_REPLY_TO=<email-de-suporte-do-dominio>
```

## Ordem ideal

1. Adicionar os 3 CNAMEs DKIM no Cloudflare.
2. Trocar o DMARC de `p=none` para `p=quarantine`.
3. Confirmar que o app esta enviando com `AUTH_SMTP_HOST=smtp.hostinger.com`.
4. Testar envio para Gmail e Outlook.
5. Se passar bem, subir o DMARC para `p=reject`.

## Observacoes importantes

- Nao use `smtp.flwdesk.com` no app, a menos que esse host exista de verdade no DNS e aponte para um servidor SMTP funcional.
- Para registros de email no Cloudflare, mantenha tudo em modo somente DNS quando houver opcao de proxy.
- DKIM e DMARC ajudam muito na reputacao, mas a propagacao pode levar ate 24 horas.

## Fontes oficiais

- Hostinger - SPF: https://www.hostinger.com/support/1583673-what-is-the-spf-record-for-hostinger-email/
- Hostinger - DKIM padrao: https://www.hostinger.com/support/4456413-what-are-the-dkim-records-for-hostinger-email/
- Hostinger - setup manual: https://www.hostinger.com/support/8650765-set-up-a-domain-for-hostinger-email/
- Hostinger - DKIM customizado: https://www.hostinger.com/support/6780535-how-to-add-a-custom-dkim-record-for-hostinger-email/
