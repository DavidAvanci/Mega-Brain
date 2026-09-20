# Backend Node independente

Este diretório é a fronteira do futuro backend Node do Mega Brain. Seus
módulos devem poder ser importados por testes e por adaptadores HTTP sem
iniciar Vite nem carregar React.

## Workflow independente

O servidor não usa o Vite em nenhum destes comandos (e `npm run dev` continua
reservado ao frontend na porta 5173):

- `npm run server:dev` inicia `server/main.ts` com `tsx watch`. Ele gera token
  e identificador de sessão efêmeros se não foram fornecidos no ambiente,
  preserva-os nos reloads e encaminha `SIGINT`/`SIGTERM` ao watcher.
- `npm run server:build` gera `dist/server/main.mjs` e seu sourcemap. É um
  bundle ESM para Node 20 no WSL, com APIs nativas de Node externas e todo o
  código TypeScript do backend incorporado; não requer Vite ou `tsx` em
  produção.
- `npm run server:test` roda somente os testes em `server/`, incluindo os
  guardrails que usam fixtures temporárias e não iniciam serviços reais.

Para executar o artefato depois do build, o supervisor fornecerá
`MEGA_BRAIN_SESSION_TOKEN` e `MEGA_BRAIN_SESSION_ID` e chamará
`node dist/server/main.mjs`. Esta execução exige os valores para preservar a
autenticação; use `server:dev` durante desenvolvimento.

- `contracts.ts` contém os contratos neutros de transporte;
- `production-routes.ts` é a única composição dos cinco domínios (workspace,
  chat, Jira, uso Claude e Café). Tanto `runtime.ts` quanto o adaptador Vite
  usam a mesma tabela de instâncias de handlers; `transport-parity.test.ts`
  falha se um transporte deixar de resolver a mesma referência.
- `runtime.ts` contém o registro mínimo de rotas para serviços extraídos;
- `index.ts` é a superfície pública do backend.

## Inicialização supervisionada

O entrypoint `server/main.ts` é iniciado pelo futuro supervisor com `tsx` no
WSL. Depois de escutar em `127.0.0.1` numa porta dinâmica, ele escreve
**exatamente uma** linha JSON no stdout:

```json
{ "type": "mega-brain-ready", "version": 1, "port": 43123, "sessionId": "..." }
```

`version` é a versão do protocolo de handshake e `sessionId` identifica a
execução, não é uma credencial. O token de autorização jamais aparece nessa
linha. Logs e diagnósticos são enviados somente ao stderr; se o backend falhar
antes de ficar pronto, stdout permanece vazio e o processo encerra com código
não-zero. `startBackendLifecycle` aceita streams e logger injetáveis para que
esse contrato seja testado sem iniciar serviços reais.

## Diagnóstico do supervisor

Depois de consumir a ready line, o supervisor chama, com o mesmo cabeçalho
`Authorization: Bearer <token>`, os endpoints autenticados abaixo. Eles são
tratados pelo listener antes do runtime de rotas, portanto não dependem de Vite
nem de um serviço de domínio já extraído.

- `GET /version` retorna `200` e versões estáveis: `apiProtocolVersion` (API
  loopback), `readyProtocolVersion` (stdout) e `runtime` (`node` + versão).
  O supervisor compara esses números antes de liberar a WebView; divergência é
  incompatibilidade, não erro transitório.
- `GET /health` retorna `200` com `status: "ready"` quando pronto; `503` com
  `starting` ou `degraded` e uma razão curta sem segredos quando o runtime não
  está utilizável. Ausência de resposta dentro do timeout do supervisor indica
  processo travado ou conexão perdida.

Os dois aceitam somente `GET` (`405` e `Allow: GET` para outro método) e nunca
são públicos: sem token retornam `401`. Payloads não incluem token, porta,
caminhos, credenciais ou conteúdo de usuário.

No modo web, `viteMegaBrainPlugin.ts` apenas recompõe o caminho removido pelo
Connect e adapta `IncomingMessage`/`ServerResponse`; o standalone aplica
autenticação, CORS, limites e lifecycle. Essas são as únicas diferenças
deliberadas de transporte. Regras de domínio, roteamento, envelopes de erro e
framing SSE continuam nos módulos compartilhados em `server/`. O Vite mantém
`localhost:5173` e não inicia o listener standalone.

## CORS da WebView

O listener standalone aceita CORS somente das origens exatas do Tauri 2
Windows confirmadas pelo spike: `http://tauri.localhost` e
`https://tauri.localhost`. A política não é configurável por ambiente em
produção. Uma origem com porta, prefixo, sufixo ou host semelhante é recusada
sem `Access-Control-Allow-Origin`; requisições sem `Origin` (por exemplo, o
supervisor) continuam sendo autenticadas normalmente e não recebem cabeçalhos
CORS.

Os preflights `OPTIONS` não precisam de token, mas precisam de uma dessas
origens e podem solicitar somente `GET`, `POST` ou `DELETE`, com os cabeçalhos
`Authorization` e `Content-Type`. Um preflight válido retorna `204`, origem
exata, métodos/cabeçalhos fechados e `Vary: Origin`. Nenhuma resposta emite
wildcard CORS.

## Logs estruturados (JSONL)

O backend escreve diagnósticos exclusivamente no `stderr`; o `stdout` continua
reservado à única ready line do supervisor. Cada linha de log é um objeto JSON
com `schemaVersion`, `timestamp`, `event` e, quando disponível, `sessionId`.
Eventos atuais são `backend.ready`, `backend.info`, `backend.error`,
`http.request` e `http.error`. Requisições adicionam somente `requestId`,
`method`, `route` (apenas pathname), `status`, `outcome` e `durationMs`.

Os campos permitidos são identificadores gerados pelo backend, nomes de evento,
status/método HTTP, rota sem query, tempos, códigos de erro e estados de ciclo
de vida. Nunca registrar bodies, queries, cabeçalhos, URLs completas, caminhos
de arquivo, prompts, conteúdo de arquivo, tokens de sessão, credenciais Jira,
e-mail Jira, cookies, stack traces ou mensagens de `Error`. `server/logger.ts`
aplica redaction defensiva por nome de campo e serializa `Error` apenas como
nome/código; erros aninhados e suas causas não são percorridos. Testes com
canários cobrem esses limites antes de qualquer sink receber dados.

## Medição reproduzível de readiness

O harness abaixo mede apenas o artefato standalone: tempo desde o `spawn` do
Node até a ready line (`ready`) e até `GET /health` autenticado (`usable`). Em
cada amostra ele gera token e sessão novos, usa porta dinâmica, não inicia
Vite, Tauri, WSL, workspace, Jira, Claude ou processos de domínio, e encerra o
filho com `SIGTERM`. Ele não registra token, stdout do filho nem stderr.

```bash
npm run server:build
npm run server:benchmark-readiness
```

Use `MEGA_BRAIN_BENCHMARK_RUNS` (1–100, padrão 10) e
`MEGA_BRAIN_BENCHMARK_TIMEOUT_MS` (100–60000, padrão 10000) para controlar a
amostra. A saída JSON contém mínimo, mediana, P95 (nearest-rank) e máximo em
milissegundos. Ela é uma medição do backend bundle no host corrente; não mede
cold start Windows, WSL, Tauri/WebView nem o tempo até o board estar usável.
