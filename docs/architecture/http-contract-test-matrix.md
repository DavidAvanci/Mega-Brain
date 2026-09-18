# Matriz de contratos HTTP extraídos

Esta matriz é executada por `server/http-contract-matrix.test.ts`. Ela usa
somente serviços falsos: não lê workspace, não inicia processos, nem chama
Claude, Jira ou PowerShell. Cada rota JSON é exercitada com método, caminho,
query e corpo representativos; o adaptador deve devolver `200`,
`Content-Type: application/json` e o corpo do serviço. A falha simulada de
cada serviço deve virar `500`, o mesmo cabeçalho e `{ "error": "falha simulada" }`.

| Área | Rotas | Sucesso | Erro | Entrada inválida | Cancelamento/SSE |
| --- | --- | --- | --- | --- | --- |
| workspace | `GET /`, `/settings`, `/detail`, `/diff`; `POST /`, `/settings`, `/open`, `/terminal`, `/prs/open`, `/dev-env`, `/dev-env/stop`, `/dev-env/agent`, `/update`, `/delete` | 14 | 14 | 12 com `name` ou body; listagem/settings GET não recebem entrada | n/a |
| chat | `GET /`; `POST /abort` | 2 | 2 | 2 | abort verificável; `POST /` abaixo |
| chat SSE | `POST /api/chat` | framing `data: JSON\\n\\n`, headers SSE e `done` | evento `done` de erro | mensagem vazia retorna `done` com erro | abort encaminha `name` para o serviço falso |
| Jira | `GET /ready`, `GET /statuses`, `POST /transition` | 3 | 3 | `statuses` e `transition`; `ready` não recebe payload | n/a |
| uso Claude | `GET /api/claude/usage` | 1 | 1 | n/a: sem query/body | n/a |
| café | `POST /api/coffee`, `DELETE /api/coffee` | 2 | 2 | n/a: sem query/body | `DELETE` chama `stop` e observa o estado |

Total: **22 rotas JSON**, mais o fluxo SSE de envio de chat. As entradas
marcadas como n/a são rotas sem query/body no contrato atual; os casos de
payload inválido cobrem todas as rotas que aceitam dados. A validação de regra
de domínio (por exemplo, card inexistente, traversal e chave Jira inválida)
continua nos testes dos serviços especializados.

O helper `legacyJsonHandler` fixa o envelope legado nos adaptadores JSON. Isso
evita que a futura API Node tenha de repetir os `try/catch` dos middlewares
Vite e mantém o formato que o frontend atual consome.
