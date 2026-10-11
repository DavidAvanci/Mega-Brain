# 02 — Planejando

## Ao entrar na etapa

1. O status é salvo e a etapa automática `task-planning` inicia, se o card não tiver outra execução ativa. A interface mostra provisoriamente “Iniciando agente” até receber o estado do servidor.
2. O agente recebe título, descrição e instruções de planejamento configuradas. Pelo fluxo: **simples** cria apenas `TASK-CHECKLIST.json`; **médio** e **difícil** criam `PLAN.md` e `TASK-CHECKLIST.json`. A checklist de desenvolvimento deve conter só tarefas de implementação.
3. O card mostra fase e progresso conforme os arquivos esperados são criados. O processo registra sessão, logs, uso e resultado. Se terminar com sucesso, na próxima leitura do quadro o servidor muda o card para **Desenvolvendo** (simples) ou **Revisão de plano** (médio/difícil), iniciando a próxima automação caso exista.
4. Se houver falha, o card permanece em Planejando e indica atenção. Uma falha por limite de uso pode provocar tentativa automática com `opus` quando a configuração e os registros permitirem. Não há transição Jira específica desta etapa na movimentação pela interface.

## Contrato técnico

**Entrada:** `POST /api/workspace/update` com `{ name: CARD_ID, status: 'planejando' }` grava `CARD_DIR/card.json`. Como `stageFor` retorna `task-planning`, `createStageController.start` chama `runStageAgent`, desde que não haja processo/`agent.json` ativo para o card. Antes do `spawn`, é capturado um snapshot dos artefatos `PLAN.md` e `TASK-CHECKLIST.json`.

**Executável e argumentos:** o provedor `claude` executa `claude -p <PROMPT> --name "<CARD_ID> · task-planning" --model <MODEL> [--fallback-model opus] --effort <EFFORT> --dangerously-skip-permissions --output-format stream-json --verbose`. O fallback `opus` é acrescentado quando o nome do modelo contém `fable`. Com provedor `chatgpt`, executa `codex exec --json --dangerously-bypass-approvals-and-sandbox [--model <MODEL>] [--config 'model_reasoning_effort="<EFFORT>"'] <PROMPT>`; `--model` é omitido quando o valor é `default`. O modelo padrão desta etapa é `fable`, e o esforço padrão é `high`; ambos podem ser configurados.

**Construção de `PROMPT`:** `planningPrompt` concatena o prompt de configuração `taskPlanning`, `card.title`, `card.description` e as instruções do fluxo lido de `card.json`. `simples` pede só `TASK-CHECKLIST.json`; `medio` pede `PLAN.md` e `TASK-CHECKLIST.json`; `dificil` usa o prompt completo para os dois artefatos. `repositoryMentionContext` acrescenta contexto de repositórios quando houver menções. O fluxo é dado ao agente no prompt, sem argumento `--flow`.

**Saída e avanço:** stdout vai para `task-planning.jsonl`, stderr para `task-planning.log`, e PID/início/modelo para `agent.json`. `readAgent` interpreta o resultado da CLI; `planningProgress` conta apenas arquivos esperados criados após o início e valida os itens executáveis do JSON. Em `GET /api/workspace`, `advanceStage` usa `FLOW_PROFILES[card.flow]` para escrever `desenvolvendo` (simples) ou `revisao-de-plano` (médio/difícil), se o agente terminou com sucesso e a checklist contém JSON válido com itens executáveis. Se o erro for limite de uso do modelo `fable`, a leitura do quadro pode reiniciar com `opus`.

## Prompt enviado ao agente

`<INSTRUÇÕES>` é literalmente o conteúdo de [taskPlanning padrão](prompts/task-planning-default.txt), salvo se `MEGA_BRAIN_SETTINGS_FILE` apontar para um JSON cujo `prompts.taskPlanning` seja uma string; nesse caso, **essa string, inclusive vazia**, substitui o padrão. `<TAREFA>` é `card.title` seguido de `\n\n` e `card.description` somente se a descrição não estiver vazia. A CLI Claude recebe o texto resultante em `-p`; a Codex recebe o mesmo texto como último argumento.

Para `flow=simples`, o texto é exatamente a concatenação abaixo com `\n` entre as linhas:

```text
<INSTRUÇÕES>
Tarefa: <TAREFA>

Fluxo SIMPLES (obrigatório): gere somente TASK-CHECKLIST.json.
Não crie nem altere PLAN.md.
A TASK-CHECKLIST.json deve ser autocontida e trazer em cada item todo o contexto necessário para a implementação.
<REGRAS_DA_CHECKLIST>
```

Para `flow=medio`, a parte após `Tarefa: <TAREFA>` é:

```text

Fluxo MÉDIO (obrigatório): gere somente PLAN.md e TASK-CHECKLIST.json.
<REGRAS_DA_CHECKLIST>
```

Para `flow=dificil`, depois de `Tarefa: <TAREFA>` há uma linha vazia e diretamente `<REGRAS_DA_CHECKLIST>`. O código não acrescenta uma frase literal “Fluxo DIFÍCIL”; o padrão `taskPlanning` já pede os dois artefatos.

`<REGRAS_DA_CHECKLIST>` inclui as regras abaixo, seguidas do contrato JSON obrigatório de `shared/domain/task-checklist.ts`. Esse contrato também é acrescentado quando o usuário personaliza as instruções de planejamento.

```text
Regra obrigatória para TASK-CHECKLIST.json: inclua somente ações de implementação.
Não crie tasks de testes de qualquer tipo, criação ou alteração de arquivos de teste, validação, conferência, QA, smoke test, revisão visual, screenshots ou verificações manuais/automatizadas.
Não inclua tarefas de teste ou verificação na checklist de implementação.
Cada item deve ser uma entrega pequena e verificável. Divida páginas extensas em estrutura, filtros, ações e integração; dê a cada parte completionCriteria próprios e deps explícitas. Preserve itens substituídos com state=discarded e atualize deps.
Declare arquivos compartilhados (helpers, exports e rotas) em files para serializar itens que os alterem. Para pré-condições use requires e para arquivos novos use creates, nunca trate uma criação prevista como requisito existente.
Quando uma migração ou base for obrigatória, registre em card.json requiredBases por repositório e use deps no item; não dependa só da descrição. Limites específicos podem ser declarados como timeoutMinutes e maxAttempts.
```

Por fim, `repositoryMentionContext` examina **todo o texto**. Se encontrar menções `@alias` de repositórios ativos, acrescenta `\n\nRepositórios mencionados (identidades verificadas no catálogo ativo):\n` e uma linha `- {"id":"...","alias":"...","path":"..."}` por repositório resolvido. Sem menções válidas, nada é acrescentado.

O planejamento só é considerado concluído quando a checklist contém ao menos um item executável e passa pela validação do contrato: versão, campos, IDs únicos, tipos, dependências existentes e ausência de ciclos. JSON parcial ou inválido mantém o progresso em criação das tasks; um agente encerrado com artefato inválido aparece com erro.

## Desenho do card fechado

```text
┌──────────────────────────────────────────────────────────┐
│ ID/pasta [sempre]      ⚠ [se atenção]  ▂▃▅ [sempre]    │
│ Título [sempre]                                          │
│ Fase do agente [se rodando, sem %/barra]                │
│ Outros agentes rodando [se houver]                       │
│ Smart Diff em execução [se ativo]                       │
│ ──────────────────────────────────────────────────────── │
│ Abrir pasta/editor · tempo relativo [sempre]            │
│                                      PRs [se houver]      │
│                         ou status Jira [se não há PRs]   │
│ Ambiente dev [se existir e não estiver parado]          │
└──────────────────────────────────────────────────────────┘
```

O indicador `▂▃▅` informa a complexidade. Enquanto o agente de planejamento roda, o card mostra sua fase sem identificá-lo como “Agente plano” e sem barra ou percentual. Agentes em execução aparecem também no modal do card, cada um com seu próprio controle para interromper. O botão para limpar a última etapa executada fica no modal, à esquerda de Excluir. `⚠` cobre erro de agente ou ambiente e agente aguardando ação. O tempo usa atualização ou criação. Os chips de PR podem persistir de uma passagem anterior; o status Jira só é mostrado quando não existe objeto de PRs. O ambiente dev só é mostrado aqui se já estiver ativo.

**Fontes:** `server/workspace/stage-catalog.ts`, `card-artifacts.ts`, `stage-transition.ts`, `board-list.ts`; `src/features/cards/ui/CardView.tsx`.
