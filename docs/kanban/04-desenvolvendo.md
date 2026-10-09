# 04 — Desenvolvendo

## Ao entrar na etapa

1. O status é salvo e inicia `run-task-checklist`, se não houver outra execução ativa. Em movimentação feita na interface, uma chave Jira válida tenta mudar para `em desenvolvimento`.
2. O script exige `TASK-CHECKLIST.md` e faz validação prévia da checklist, das dependências e das worktrees. Prepara os repositórios citados, confere bases obrigatórias e impede a execução se uma worktree de integração estiver suja ou faltar pré-condição. Recupera trabalho de itens preservado de execuções anteriores quando possível.
3. Executa itens com até **quatro agentes em paralelo**, em worktrees próprias. Respeita dependências, limites de tempo e tentativas definidos nos itens, registra tentativas, faz commits ignorando hooks Git (`--no-verify`) e integra o trabalho. Também tenta reparar testes que tenham falhado durante o desenvolvimento.
4. Quando a leva de executores termina, mesmo com falhas, inicia um agente de verificação para rodar os checks configurados em cada projeto, limitados aos arquivos alterados pelo card. Checks sem suporte a escopo por arquivo e hooks que modificariam arquivos são registrados como ignorados. Para cada check reprovado, ele gera uma task de correção na `TASK-CHECKLIST.md`; o scheduler executa outra leva e a verificação se repete. O padrão permite até cinco levas de correção (`CHECKLIST_MAX_VERIFICATION_WAVES`) e 60 minutos por agente de verificação (`CHECKLIST_VERIFICATION_TIMEOUT_MINUTES`).
5. O progresso vem das caixas marcadas em `TASK-CHECKLIST.md`. Se todas as tasks e verificações terminam com sucesso, a próxima leitura do quadro move o card para **Code Review**. Uma falha ou o limite de correções atingido deixa o card na etapa e mostra atenção.

## Contrato técnico

**Processo de etapa:** a entrada por `POST /api/workspace/update` grava `status: 'desenvolvendo'` em `card.json`. `stageFor` seleciona `run-task-checklist`. Em código fonte, o backend chama `spawn(MEGA_ROOT/node_modules/.bin/tsx, [MEGA_ROOT/scripts/commands/dev-stage.ts, CARD_DIR])`; no bundle chama `spawn(NODE, [runtime.mjs, CARD_DIR])` com `MEGA_BRAIN_STAGE_SCRIPT=run-task-checklist`. O processo roda em `cwd=CARD_DIR`, com stdout em `run-task-checklist.jsonl`, stderr em `run-task-checklist.log` e metadados em `agent.json`.

**Parâmetros e arquivos:** `dev-stage.ts` lê `CARD_DIR/TASK-CHECKLIST.md`, lê `PLAN.md` se existir para dar contexto aos itens e usa `card.json` para identificar tarefa, branch e `requiredBases`. `CHECKLIST_MODEL`/`CHECKLIST_EFFORT` vêm da configuração da etapa (padrão `fable`/`low`); `MEGA_BRAIN_WORKTREES_DIR` define a raiz das worktrees. O parser da checklist extrai `repo`, `id`, `deps`, `files`, `requires`, `creates`, `timeoutMin` e `attempts`.

**Agentes de item:** para cada item pronto, `runChecklist({ max: 4 })` cria uma worktree própria e chama `runClaudeItem`. Com provedor Claude, o formato é `claude -p <PROMPT_DO_ITEM> --name "<CARD_ID> · <ITEM_ID>" --model <MODEL> [--fallback-model opus] --effort <EFFORT> --json-schema <RESULT_SCHEMA> --strict-mcp-config --mcp-config '{"mcpServers":{}}' --tools Read,Edit,Write,Grep,Glob,Bash --dangerously-skip-permissions --output-format json`. Com provedor ChatGPT, é `codex exec --json --dangerously-bypass-approvals-and-sandbox [--model <MODEL>] --config 'model_reasoning_effort="<EFFORT>"' <PROMPT_DO_ITEM+INSTRUÇÃO_JSON>`. O comando do item roda com `cwd` na worktree. `<PROMPT_DO_ITEM>` **não é texto literal**: representa uma única string produzida por `buildPrompt(item, plan.raw)` e passada como um único argumento da CLI. Sua [montagem completa está abaixo](#prompts-enviados-aos-agentes); o retorno esperado tem `status` (`done`, `failed` ou `blocked`) e `note`.

**Persistência e fim:** cada tentativa vai para `execution-attempts.json`; `TASK-CHECKLIST.md` recebe marcas de conclusão/falha/bloqueio e as tasks de correção geradas por verificações. Itens concluídos são commitados e integrados na feature branch com `--no-verify`. Cada rodada de verificação grava `verification-round-N.json` no diretório do card. `readAgent` extrai o resultado do log da etapa e `checklistProgress` conta as caixas concluídas. Em `GET /api/workspace`, `advanceStage` consulta `FLOW_PROFILES` e grava `code-review` após resultado de sucesso.

## Prompts enviados aos agentes

O processo `dev-stage.ts` **não recebe um prompt**: ele executa código. Os agentes filhos recebem um prompt por item. `<PROMPT_DO_ITEM>` é o resultado de `buildPrompt(item, plan.raw)`. Seu primeiro bloco, `<TASK_ITEM>`, é o texto literal de [taskItem padrão](prompts/task-item-default.txt), substituído por `prompts.taskItem` do JSON em `MEGA_BRAIN_SETTINGS_FILE` quando esse valor é uma string não vazia. O resultado passado ao Claude em `-p` é:

```text
<PROMPT_DO_ITEM> = <TASK_ITEM>
                 + "\nItem: " + item.id + " — " + item.text
                 + "\nArquivos permitidos: " + (item.files.join(", ") ou "(não especificado)")
                 + (contexto ? "\n\nContexto do plano:\n" + contexto : "")
```

`contexto` é a seção de `PLAN.md` identificada pelo ID do item. O molde renderizado fica assim:

```text
<TASK_ITEM>
Item: <ITEM_ID> — <TEXTO_DO_ITEM>
Arquivos permitidos: <FILES_SEPARADOS_POR_VÍRGULA>

Contexto do plano:
<SEÇÃO_DO_PLAN_MD_PARA_ITEM_ID>
```

`Arquivos permitidos` vira literalmente `(não especificado)` quando `item.files` é vazio. O bloco `Contexto do plano` **inteiro**, inclusive sua linha vazia inicial, é omitido se `itemContext(PLAN.md, item.id)` não encontrar seção correspondente. `<TEXTO_DO_ITEM>`, `<FILES>` e `<ITEM_ID>` vêm de `TASK-CHECKLIST.md`; a seção de contexto vem de `PLAN.md`. O prompt não inclui automaticamente o `PLAN.md` inteiro nem o tipo de fluxo.

Para itens de desenvolvimento, `runClaudeItem` acrescenta somente no caso Codex este sufixo literal, separado por duas quebras de linha:

```text
Ao terminar, responda somente com JSON válido no formato {"status":"done|failed|blocked","note":"resumo curto"}.
```

No caso Claude, a exigência de saída é transmitida por `--json-schema` com `status` (`done|failed|blocked`) e `note` (string), além das instruções já contidas em `<TASK_ITEM>`; não há esse sufixo adicional no prompt.

## Desenho do card fechado

```text
┌──────────────────────────────────────────────────────────┐
│ ID/pasta [sempre]      ⚠ [se atenção]  ▂▃▅ [sempre]    │
│ Título [sempre]                                          │
│ Agentes dos itens + interrupção individual [se ativos]  │
│ Progresso global + % + interromper todos [se ativo]     │
│ Smart Diff em execução [se ativo]                       │
│ ──────────────────────────────────────────────────────── │
│ Abrir pasta/editor · tempo relativo [sempre]            │
│                                      PRs [se houver]      │
│                         ou status Jira [se não há PRs]   │
│ Ambiente dev [se existir e não estiver parado]          │
└──────────────────────────────────────────────────────────┘
```

`▂▃▅` indica o nível do fluxo. Cada agente ativo ligado a um item da `TASK-CHECKLIST.md` aparece em sua linha, com o código do item e um botão para interrompê-lo. Antes de chegar atividade do Claude, a linha mostra `Iniciando <código>...`. A barra abaixo das linhas mostra o progresso global da checklist, com percentual e um botão para interromper toda a etapa e seus agentes. `⚠` sinaliza erro de agente ou ambiente, ou agente aguardando ação. Tempo, PRs, Jira e ambiente seguem os dados do card, inclusive se vierem de uma passagem anterior. O status Jira fica oculto quando há objeto de PRs.

**Fontes:** `scripts/commands/dev-stage.ts`, `scripts/lib/scheduler.ts`; `server/workspace/stage-catalog.ts`, `stage-transition.ts`; `src/features/cards/model/card-commands.ts`; `src/features/cards/ui/CardView.tsx`.
