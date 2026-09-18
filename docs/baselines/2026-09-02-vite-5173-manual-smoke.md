# Smoke manual do modo web em 5173 — 2026-09-02

## Objetivo e preservação do ambiente

Verificar o fluxo web atual após a extração dos adaptadores da Fase 3, sem
alterar workspace, cards, Jira, chat/Claude, estágios ou Café.

Antes do teste, `curl http://127.0.0.1:5173/` falhou com conexão recusada:
a porta 5173 estava livre. Por isso foi iniciada uma única instância temporária
do Vite com `npm run dev`; ela foi tratada como pertencente exclusivamente a
este smoke e encerrada ao final. Nenhum processo preexistente foi reiniciado ou
encerrado.

## Evidência anterior

O baseline pré-Tauri em `2026-09-01-pre-tauri.md` registra que o build web
passava com Vite 6.4.3. A compatibilidade de contrato antes do smoke foi
verificada pelos testes de paridade do adaptador Vite e do servidor Node,
registrados em `../architecture/vite-standalone-contract-parity.md`. Os
contratos relevantes são GET `/api/workspace`, GET
`/api/workspace/settings`, GET `/api/jira/ready` e GET
`/api/claude/usage`.

Não havia uma instância 5173 ativa para capturar uma segunda resposta "antes"
sem iniciar o ambiente. Assim, a evidência anterior acima é o comparativo sem
inventar uma resposta de uma instância que não existia.

## Smoke posterior (somente leitura)

Com Vite pronto em `http://localhost:5173`, foram feitos GETs locais, cada um
com timeout de 20 segundos. Foram registrados somente status, tamanho e forma
da resposta; conteúdo de cards, configurações, Jira e uso não foi gravado.

| Check | Resultado |
| --- | --- |
| `GET /` | `200`; 615 bytes; HTML contém `#root` e script de módulo React. |
| `GET /api/workspace` | `200`; array com 8 entradas. |
| `GET /api/workspace/settings` | `200`; objeto com `stages`. |
| `GET /api/jira/ready` | `200`; array com 21 entradas. |
| `GET /api/claude/usage` | `200`; objeto com `fiveHour`, `sevenDay` e `fable`. |

Não foi usado browser/E2E: Playwright não é dependência do projeto. A resposta
HTML e o carregamento do módulo confirmam o ponto de entrada da UI; as APIs
consultadas são as leituras carregadas pelo board atual.

## Conclusão

Os formatos e estados HTTP observados são compatíveis com os contratos
registrados antes da migração. O smoke não enviou `POST`, `DELETE`, nem chamou
detail, chat, Claude, estágios, Café ou transições do Jira. Não houve mudança
de estado observável.
