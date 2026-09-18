# Inventário das APIs Vite e efeitos colaterais

Registro da Fase 0 para orientar a extração em `server/`. As rotas abaixo são
middlewares do servidor de desenvolvimento Vite; `vite.config.ts` injeta o
diretório `WORKSPACE_DIR` (ou `./mega-brain-files/workspace`) nos plugins de workspace e chat,
as credenciais `JIRA_*` no Jira e usa a porta fixa 5173.

## Convenções atuais

- As respostas normais são JSON, exceto o envio de chat, que usa SSE.
- Erros capturados pelos plugins retornam HTTP 500 e `{ "error": "..." }`;
  várias entradas inválidas são tratadas dessa forma hoje, não como 400.
- O middleware delega métodos/caminhos não reconhecidos com `next()`, quando
  aplicável. A futura API deve preservar os contratos usados pelo frontend
  antes de melhorar códigos de erro.
- A validação de card aceita somente nomes `^[\\w.-]+$`, rejeita `..` e exige
  que a pasta exista. Repositórios de cards são symlinks que apontam para um
  diretório com `.git`.

## Workspace — `workspacePlugin.ts`

| Rota | Operação | Efeitos e dependências |
| --- | --- | --- |
| `GET /api/workspace` | Lista cards | Cria o diretório raiz se ausente; lê `card.json`, `agent.json`, logs/tails de Claude e estado de dev-env; consulta `/proc` para Claudes externos; pode encerrar e apagar cards em `producao` expirados, limpar `agent.json`, reexecutar etapa limitada por rate limit com Opus e avançar etapas concluídas. Consulta assíncrona de estado de PR via `gh`. |
| `GET /api/workspace/settings` | Configuração de etapas | Lê `.mega-brain-settings.json` da raiz. |
| `GET /api/workspace/detail?name=` | Artefatos do card | Lê `PLAN.md`, `TASK-CHECKLIST.md` e `TEST-CHECKLIST.md` do card. |
| `GET /api/workspace/diff?name=` | Diffs de repositórios | Resolve os symlinks Git do card; executa `git merge-base`, `git diff` e `git ls-files`, inclusive diff de arquivos não rastreados. |
| `POST /api/workspace/settings` | Salva configuração | Valida modelo/effort e grava `.mega-brain-settings.json`. |
| `POST /api/workspace/open` | Abre card no editor | Inicia `cursor <pasta-do-card>` destacado. |
| `POST /api/workspace/terminal` | Retoma agente em terminal | Lê sessão do agente e abre Windows Terminal (`wt.exe wsl.exe --cd ...`) no WSL, ou terminal Linux, executando `claude --resume <sessão>`. |
| `POST /api/workspace/prs/open` | Abre PRs | Lê URLs do `card.json` e inicia Chrome/Google Chrome destacado em nova janela. |
| `POST /api/workspace/dev-env` | Inicia ambiente dev | Planeja e inicia dependências/repos e servidores por `devEnv.ts`; instala dependências/usa Git quando necessário, grava `.dev-env/state.json`, cria worktree quando aplicável e inicia processos destacados. |
| `POST /api/workspace/dev-env/stop` | Para ambiente dev | Mata somente processos registrados do ambiente e atualiza seu estado. |
| `POST /api/workspace/dev-env/agent` | Abre agente de teste | Abre terminal com Claude Haiku e `/run-test-env`. |
| `POST /api/workspace/update` | Edita card/move etapa | Regrava `card.json`; ao mudar para uma etapa automatizada, inicia Claude ou script destacado, grava `agent.json`, `.jsonl` e `.log`. |
| `POST /api/workspace/delete` | Exclui card | Para o dev-env do card e remove recursivamente sua pasta. |
| `POST /api/workspace` | Cria card | Cria pasta com nome slug/solicitado e grava `card.json` inicial. |

### Processos e dados auxiliares do workspace

- Etapas podem chamar `claude` com permissões sem confirmação ou o executável
  local `node_modules/.bin/tsx` para scripts de checklist/stage/PR.
- `claudeBin()` procura o executável no `PATH`; `claudeCwds()` inspeciona
  `/proc/<pid>/cmdline` e `/cwd`; históricos vêm de `~/.claude/projects`.
- `devEnv.ts` também executa Git, comandos de gerenciador de pacotes e
  processos de desenvolvimento; `prStatus.ts` chama `gh pr view`.
- A listagem tem efeitos de manutenção. Isso precisa continuar explícito no
  serviço extraído para que um simples `GET` não passe a ter comportamento
  diferente por acidente.

## Chat — `chatPlugin.ts`

| Rota | Operação | Efeitos e dependências |
| --- | --- | --- |
| `GET /api/chat?name=` | Histórico | Resolve a sessão preferencial (a do `agent.json`, ou a `.jsonl` mais recente) em `~/.claude/projects`, lê até 512 KiB e devolve no máximo 80 entradas, mais `sessionId`. |
| `POST /api/chat` | Envia mensagem | Valida card/mensagem e exclusividade; inicia `claude -p` no diretório do card com `--resume` ou nova UUID, streaming JSON, configuração MCP vazia e `--dangerously-skip-permissions`. Transforma a saída em SSE `text`, `tool` e `done`. Mantém o processo ativo mesmo se a resposta HTTP for fechada. |
| `POST /api/chat/abort` | Cancela chat | Envia `SIGTERM` ao processo de chat daquele card e retorna `{ ok: true }`. |

O plugin bloqueia chat se já houver chat em execução, uma etapa estiver rodando
ou houver Claude aberto no terminal do mesmo card. Mantém um mapa em memória de
processos em execução e um `WeakSet` para distinguir cancelamento de falha.

## Jira — `jiraPlugin.ts`

| Rota | Operação | Efeitos e dependências |
| --- | --- | --- |
| `GET /api/jira/ready` | Busca fila READY | Quando configurado, chama Jira Cloud com JQL do usuário atual, até 100 itens; converte ADF de descrição em texto. Sem credenciais, retorna `[]`. |
| `GET /api/jira/statuses?keys=` | Busca status | Aceita apenas chaves `PROJ-123`, normaliza para maiúsculas, consulta Jira e mantém cache de 60 segundos. Sem credenciais, retorna `{}`. |
| `POST /api/jira/transition` | Transiciona issue | Busca transições, compara nomes sem acentos/case, faz `POST` da transição e atualiza cache. Sem credenciais, retorna `{ skipped: true }`. |

Todas as chamadas usam Basic Auth construído de `JIRA_EMAIL:JIRA_API_TOKEN` e
`https://<JIRA_SITE>.atlassian.net`. O serviço extraído não pode logar esse
cabeçalho nem token.

## Uso Claude — `claudeUsagePlugin.ts`

| Rota | Operação | Efeitos e dependências |
| --- | --- | --- |
| `GET /api/claude/usage` | Consulta consumo | Lê `~/.claude/.credentials.json`, extrai o OAuth access token e chama `https://api.anthropic.com/api/oauth/usage`; normaliza janelas de 5h/7d/Fable, com cache de 60 segundos. Falha, arquivo ou token ausente retornam o objeto vazio, sem erro. |

O token só é usado no header Bearer. Nunca deve aparecer em resposta ou log.

## Café — `coffeePlugin.ts`

| Rota | Operação | Efeitos e dependências |
| --- | --- | --- |
| `POST /api/coffee` | Inicia sessão | Inicia `powershell.exe` com script base64. O script marca o sistema como ativo, bloqueia a estação, aguarda o desbloqueio e então restaura o estado de energia. |
| `DELETE /api/coffee` | Para sessão | Mata o processo PowerShell em memória e retorna o estado. |

O plugin também chama `stop()` quando o `httpServer` do Vite fecha. O backend
independente deve manter a mesma limpeza no seu encerramento.

## Fronteiras para a extração

1. Mover regras de domínio, validação e funções de processo/arquivos para
   serviços sem import de `vite`.
2. Fazer cada plugin Vite virar um adaptador HTTP fino para esses serviços;
   criar um segundo adaptador para o servidor Node independente.
3. Preservar temporariamente os formatos JSON/SSE, inclusive os casos sem
   credenciais e os efeitos de manutenção da listagem de workspace.
4. Introduzir depois autenticação, limite de body, timeouts e códigos HTTP mais
   precisos no servidor independente, com testes de contrato que documentem a
   compatibilidade pretendida.
