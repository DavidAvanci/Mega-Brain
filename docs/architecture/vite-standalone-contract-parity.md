# Paridade de contrato: Vite e backend standalone

`server/transport-parity.test.ts` executa a mesma matriz HTTP duas vezes: uma
via o adaptador Connect/Vite montado em um `node:http` de teste, e outra via o
listener standalone. Ambos escutam exclusivamente em `127.0.0.1` com porta
`0`; a suíte não inicia Vite, não usa a porta 5173 e usa apenas serviços falsos.

Os casos idênticos cobrem os cinco domínios (workspace, chat, Jira, uso Claude
e Café), respostas JSON de sucesso, envelopes de erro de domínio, rota/método
inexistente, validação de entrada, primeira frame SSE e cancelamento ao fechar
o cliente. As respostas de domínio (status, corpo JSON, content type e framing
SSE) devem ser iguais nos dois transports.

As únicas diferenças permitidas pertencem à fronteira de transporte:

- o backend standalone exige `Authorization: Bearer`, enquanto o Vite local
  preserva o modo web sem token;
- somente o backend standalone aplica a allowlist CORS de `tauri.localhost`;
- JSON sintaticamente inválido é rejeitado pelo parser standalone com `400`,
  enquanto o adaptador Vite legado o converte no envelope `500` existente.

Execute com `TMPDIR=/tmp npx vitest run server/transport-parity.test.ts`.
