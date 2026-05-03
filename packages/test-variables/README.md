# @flowdesk/test-variables

CLI oficial para autenticar no ambiente interno da Flowdesk, solicitar credenciamento de IP e consumir Test Variables autorizadas sem carregar segredos no pacote.

## Instalacao

```bash
npm i -D @flowdesk/test-variables
```

## Comandos

```bash
flw login
flw whoami
flw ip
flw ip request --project flowdesk --env test
flw env pull --project flowdesk --env test
flw dev --project flowdesk --env test -- npm run dev
```

## Observacoes

- `flw login` abre o navegador e aguarda a aprovacao web.
- `flw env pull` nao grava segredos em arquivo sem `--write`.
- `flw dev` injeta as variaveis apenas no processo filho informado.
- O CLI espera Node `>=22.6.0`.
