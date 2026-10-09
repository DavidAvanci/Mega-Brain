# Etapas do Kanban

Esta documentação descreve o comportamento implementado em outubro de 2026. Cada arquivo mostra o **card fechado na coluna**, suas informações permanentes e condicionais, e o que acontece ao entrar na etapa. O modal aberto ao clicar no card é uma interface distinta.

| Grupo    | Etapa             | Documento                                         |
| -------- | ----------------- | ------------------------------------------------- |
| Plano    | A fazer           | [01 — A fazer](01-a-fazer.md)                     |
| Plano    | Planejando        | [02 — Planejando](02-planejando.md)               |
| Plano    | Revisão de plano  | [03 — Revisão de plano](03-revisao-de-plano.md)   |
| Execução | Desenvolvendo     | [04 — Desenvolvendo](04-desenvolvendo.md)         |
| Execução | Code Review       | [06 — Code Review](06-code-review.md)             |
| Entrega  | Staging           | [07 — Staging](07-staging.md)                     |
| Entrega  | Aguardando deploy | [08 — Aguardando deploy](08-aguardando-deploy.md) |
| Entrega  | Produção          | [09 — Produção](09-producao.md)                   |

## Regras transversais

- Arrastar um card ou escolher uma etapa no modal atualiza `card.json`. A interface mostra a mudança imediatamente e consulta o servidor a cada 5 segundos. Ao **entrar em uma etapa automática por mudança de status**, o servidor inicia sua execução se não houver outra execução ativa no card. Salvar o mesmo status ou mudar só a complexidade não reinicia a etapa.
- O fluxo **simples** vai de Planejando a Desenvolvendo e daí a Code Review. Os fluxos **médio** e **difícil** passam por Revisão de plano antes de Desenvolvendo; todos seguem diretamente para Code Review quando o desenvolvimento termina. Essas passagens são processadas na leitura do quadro quando o agente conclui com sucesso. Staging e Aguardando deploy não avançam automaticamente depois que seus scripts terminam.
- Após uma **movimentação feita na interface**, cards com chave Jira válida (`PROJ-123`, por exemplo) tentam atualizar o status no Jira apenas nas etapas mapeadas: Desenvolvendo → `em desenvolvimento`; Code Review → `CODE REVIEW`; Staging → `STAGING`; Aguardando deploy → `AGUARDANDO DEPLOY`; Produção → `EM PRODUÇÃO`. A transição não é chamada por esse caminho quando o servidor avança uma etapa sozinho. Os scripts de PR também podem atualizar o Jira, conforme os documentos das etapas.
- Cada agente em execução tem um controle individual para interrompê-lo junto à sua linha; na etapa Desenvolvendo, o progresso também oferece um controle para interromper toda a etapa e seus agentes. Para etapas automáticas, a interrupção restaura os artefatos acompanhados e limpa logs/progresso da etapa; código, commits e PRs já criados permanecem. O botão “Limpar <etapa>” no modal remove os artefatos e registros da última etapa executada. Não há reinício automático depois da interrupção enquanto o status não mudar.
- O desenho de cada documento usa `[sempre]` e `[se ...]`. Os elementos condicionais dependem dos dados disponíveis, não são uma promessa de que apareçam em toda visita à coluna. Informações de etapas anteriores, como PRs ou um ambiente dev ainda ligado, podem continuar visíveis em etapas posteriores.

## Convenções técnicas dos comandos

Os blocos de comando são **representações dos argumentos passados ao processo**, não comandos colados em um `bash`. O backend usa `child_process.spawn(bin, args, { cwd: CARD_DIR, detached: true })` sem `shell: true`. `CARD_DIR` é a pasta do card; `MEGA_ROOT` é a raiz da instalação; `NODE` é `process.execPath`. Os valores entre `<...>` são substituídos em tempo de execução. No modo de código fonte, as três etapas de script iniciam `MEGA_ROOT/node_modules/.bin/tsx MEGA_ROOT/scripts/commands/<script>.ts CARD_DIR`. No bundle, iniciam `NODE <runtime.mjs> CARD_DIR`, com `MEGA_BRAIN_STAGE_SCRIPT` selecionando o script interno (`run-task-checklist`, `stage-task` ou `master-pr-task`).

O processo de etapa recebe `CHECKLIST_MODEL`, `CHECKLIST_EFFORT`, `MEGA_BRAIN_LLM_PROVIDER`, `MEGA_BRAIN_SETTINGS_FILE`, `MEGA_BRAIN_WORKTREES_DIR`, `MEGA_BRAIN_CARD_ID`, `MEGA_BRAIN_CARD_PATH` e caminhos configurados para as CLIs. `agent.json` guarda PID, início, etapa e modelo; `NOME_DA_ETAPA.jsonl` recebe stdout; `NOME_DA_ETAPA.log` recebe stderr. O backend lê esses arquivos para projetar status, fase e progresso. O modelo/esforço padrão das etapas configuráveis vêm de `.mega-brain-settings.json` na raiz do workspace; os prompts personalizados vêm do arquivo de configurações indicado por `MEGA_BRAIN_SETTINGS_FILE`.

`flow` (`simples`, `medio`, `dificil`) fica em `card.json`. Ele é incorporado ao **texto do prompt de planejamento** e consultado pelo servidor para decidir a próxima coluna e os arquivos esperados. Não há uma flag `--flow` nas CLIs. Nas etapas de checklist, o modelo/esforço é transmitido por variáveis de ambiente e repassado às CLIs de cada item.

No executor de itens, `--model` do Codex é omitido quando a configuração contém `fable`, `opus`, `sonnet`, `haiku` ou `default`; nesses casos o Codex usa o próprio padrão. `runClaudeItem` é o nome da função compartilhada, mas ela também pode iniciar Codex quando `MEGA_BRAIN_LLM_PROVIDER=chatgpt`.

## Textos literais dos prompts padrão

Os arquivos abaixo são cópias UTF-8 **sem paráfrase** dos valores em `shared/domain/prompt-defaults.ts`. Eles mostram o padrão do código; um usuário pode substituí-lo nas configurações. Os documentos das etapas mostram a montagem final e todos os campos variáveis. Sem o conteúdo de um card, de suas checklists e das configurações efetivas, não existe um único prompt final para transcrever.

- [Planejamento: `taskPlanning`](prompts/task-planning-default.txt)
- [Item de desenvolvimento: `taskItem`](prompts/task-item-default.txt)
- [Revisão Smart Diff, acionada manualmente: `smartDiffReview`](prompts/smart-diff-review-default.txt)
- [Agente de ambiente dev, acionado manualmente: `testEnvironment`](prompts/test-environment-default.txt)

Os prompts opcionais de Smart Diff e do agente de ambiente dev dependem de um clique e podem aparecer em cards de outras colunas se o estado do card permitir. A montagem está detalhada em [Code Review](06-code-review.md); a entrada em Code Review não executa essas ações.

## Dependência de skills do Claude

O núcleo do Kanban e as etapas Planejando e Desenvolvendo não carregam um `SKILL.md` do Claude. Quando o provedor dos itens é Claude, o executor desativa MCPs externos (`--strict-mcp-config --mcp-config '{"mcpServers":{}}'`) e passa um conjunto explícito de ferramentas à CLI.

O prompt padrão de Smart Diff usa o marcador `<script-de-revisao>`, substituído pelo backend pelo script incluído em `server/workspace/smart-diff-review-cli.mjs`. O marcador antigo de prompts personalizados continua aceito por compatibilidade. A geração requer a ferramenta externa `smart-diff` em `SMART_DIFF_DIR` ou `~/smart-diff`. O prompt `taskItem` também menciona `CLAUDE.md` como regra de estilo, mas o Mega Brain não abre esse arquivo por conta própria.

## Fontes principais

- `shared/domain/cards.ts`, `src/features/cards/ui/CardView.tsx`, `src/CardAgentBadge.tsx`, `src/features/dev-environments/DevEnvPanel.tsx`: colunas, campos e card visível.
- `src/features/cards/model/card-commands.ts`, `src/features/cards/integrations/jira.ts`: movimentação pela interface e Jira.
- `server/workspace/stage-catalog.ts`, `stage-transition.ts`, `card-update.ts`, `board-list.ts`, `worktree-lifecycle.ts`: execução, avanço e limpeza.
- `scripts/commands/`: trabalhos de desenvolvimento, testes e PRs.
