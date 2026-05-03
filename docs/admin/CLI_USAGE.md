# CLI Usage

## Pacote

Pacote interno:

- `@flowdesk/test-variables`

Instalacao:

```bash
npm i -D @flowdesk/test-variables
```

## Comandos

```bash
flw login
flw logout
flw whoami
flw ip
flw ip request --project flowdesk --env test --device "Notebook" --reason "Debug"
flw env pull --project flowdesk --env test
flw dev --project flowdesk --env test -- npm run dev
```

## Login

- o CLI chama `/api/dev-auth/login/start`
- abre o navegador para `/dev-auth/complete?...`
- a sessao web aprova a tentativa
- o terminal faz polling em `/api/dev-auth/login/complete`
- o token local e salvo em `~/.flowdesk/test-variables.json`

## Next.js

Uso recomendado:

```bash
flw dev --project flowdesk --env test -- next dev
```

Ou:

```bash
flw dev --project flowdesk --env test -- npm run dev
```

As variaveis sao injetadas antes do processo subir.

## Erros Comuns

- `Nenhuma credencial local encontrada`
  - rode `flw login`
- `Use flw env pull --project <codigo> --env <ambiente>`
  - faltou informar projeto ou ambiente
- bloqueio de leitura
  - verifique grant, IP aprovado e certificado FLWIP
