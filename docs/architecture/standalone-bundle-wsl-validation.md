# Validação do bundle standalone no WSL

Data: 2026-09-02  
Status: **concluída — item final da Fase 2 validado em 2026-09-02**.

## Escopo isolado

Foi executado `npm run server:build` e, em seguida, exclusivamente o artefato
produzido com `node dist/server/main.mjs` no WSL. A execução recebeu porta `0`,
token e identificador de sessão descartáveis e diretórios temporários separados
para `HOME`, `WORKSPACE_DIR`, dados Claude e `TMPDIR`/`TMP`/`TEMP`. Nenhum
workspace, credencial Jira, sessão Claude, processo Vite ou porta 5173 foi
usado.

O sandbox de desenvolvimento não permite bind TCP local; a prova HTTP foi
repetida com autorização para executar este único processo Node, sempre em
`127.0.0.1` e porta dinâmica. O processo foi encerrado por `SIGTERM` no fim.

## Evidências obtidas

`npm run server:build` concluiu e gerou:

```text
Backend bundle: dist/server/main.mjs (89905 bytes)
```

O artefato executado diretamente pelo Node publicou uma única ready line:

```json
{ "type": "mega-brain-ready", "version": 1, "port": 38965, "sessionId": "bundleproofsessionid20260902" }
```

Com `Authorization: Bearer <token-de-teste>`, os diagnósticos retornaram:

```json
GET /health                         -> 200 {"service":"mega-brain-backend","apiProtocolVersion":1,"status":"ready"}
GET /version                        -> 200 {"service":"mega-brain-backend","apiProtocolVersion":1,"readyProtocolVersion":1,"runtime":{"name":"node","version":"18.19.1"}}
GET /api/workspace/settings         -> 200 (configuração padrão do fixture)
GET /api/chat?name=card             -> 200 {"sessionId":null,"entries":[]}
GET /api/jira/ready                 -> 200 []
GET /api/claude/usage               -> 200 (janelas nulas sem credencial)
```

Sem token, `GET /health` retornou `401 {"error":"Não autorizado"}`. Após
`SIGTERM`, o processo terminou com exit code `0`; os logs registraram
`backend.stopping` e `backend.stopped`, e não restou processo filho deste teste.

O runtime de produção agora compõe workspace, chat, Jira, uso Claude e Café
antes de escutar, sem executar I/O, chamar rede ou iniciar processos nessa
composição. A única escrita do workspace (criar sua pasta ausente) foi adiada
para a primeira rota de workspace. Chat, workspace e Café recebem o mesmo
`ProcessOwner`, para que filhos criados pelo backend sejam encerrados juntos.

SSE e cancelamento foram exercitados com Claude falso e workspace temporário:
`server/main-sse.test.ts` confirmou frames progressivos, `POST /api/chat/abort`
com `SIGTERM` do filho falso e cancelamento quando o cliente desconecta. A
execução conjunta de `runtime-production`, `main-sse`, `main` e
`process-lifecycle` passou com 16 testes; ela não usa Claude, Jira, Vite nem
workspaces reais.

Uma busca estática em `dist/server/main.mjs` não encontrou referências a
`vite` nem `tsx`; o bundle foi iniciado por `node`, não por `tsx` ou Vite.

## Lacuna anterior, resolvida

A rota representativa autenticada `GET /api/jira/ready` retornou:

```json
404 {"error":"Rota não encontrada"}
```

`runFromCommandLine()` agora instancia o runtime composto e compartilha seu
`ProcessOwner`; a rota Jira acima confirmou que o registro não está vazio.

## Dependências de runtime observadas

- WSL com Node `v18.19.1` executou o bundle nesta máquina.
- O build requer `esbuild` presente em `node_modules`.
- O artefato usa APIs nativas externas do Node; não precisa de Vite ou `tsx` em
  produção.

O bundle é compilado com alvo Node 18, compatível com o mínimo registrado de
Node 18.19+ e com a prova executada em Node 18.19.1.
