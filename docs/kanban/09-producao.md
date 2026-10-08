# 09 — Produção

## Ao entrar na etapa

1. O status é salvo. Não há script ou agente automático associado à entrada em Produção, nem deploy disparado por essa movimentação. Se a mudança foi feita na interface e o card tem chave Jira válida, a interface tenta mudar o chamado para `EM PRODUÇÃO`.
2. O card permanece visível por aproximadamente **24 horas desde a última modificação de `card.json`**. Ao listar o quadro após esse prazo, o servidor interrompe o ambiente dev, remove as worktrees gerenciadas e apaga a pasta do card. Portanto, a limpeza ocorre na leitura do quadro, não exatamente no instante em que o prazo vence.
3. PRs registrados e ambientes dev ainda ativos podem continuar visíveis durante esse período. A exclusão pode falhar se uma worktree não puder ser removida; nesse caso, a listagem registra o erro em vez de ocultar silenciosamente o card.

## Contrato técnico

**Entrada:** uma movimentação manual envia `POST /api/workspace/update` com `{ name: CARD_ID, status: 'producao' }`. `updateCard` reescreve `CARD_DIR/card.json`. `stageFor('producao')` retorna `undefined`: não há `spawn`, comando de deploy, prompt, log ou agente novo. Para uma chave Jira válida, a interface tenta `POST /api/jira/transition` com `EM PRODUÇÃO` depois de atualizar o card.

**Prazo e gatilho de exclusão:** cada `GET /api/workspace` chama `listBoardCards`. Para um card em Produção, `expiredInProduction` compara `Date.now()` com o `mtime` de `CARD_DIR/card.json`; o limiar é `24 * 60 * 60 * 1000` ms. A contagem usa a última gravação do arquivo, inclusive uma edição posterior, e não uma data fixa de entrada. O frontend consulta a listagem a cada cinco segundos enquanto o quadro está ativo.

**Limpeza após o prazo:** `deleteCard` chama `stopDevEnv(CARD_DIR)`, enumera as worktrees gerenciadas do card e dos itens, usa `git worktree remove --force <PATH>` e `git worktree prune` quando aplicável, remove a pasta gerenciada de itens e finalmente apaga `CARD_DIR` de forma recursiva. Só worktrees comprovadamente dentro da raiz gerenciada são elegíveis. Falha na remoção interrompe a operação e é exposta pela listagem.

## Prompt enviado a agentes

Nenhum. A entrada em Produção e a limpeza após 24 horas usam chamadas do backend e comandos Git, sem `spawn` de Claude/Codex e sem prompt de etapa.

## Desenho do card fechado

```text
┌──────────────────────────────────────────────────────────┐
│ ID/pasta [sempre]      ⚠ [se atenção]  ▂▃▅ [sempre]    │
│ Título [sempre]                                          │
│ Agentes rodando + progresso [se houver]                  │
│ Smart Diff em execução [se ativo]                       │
│ ──────────────────────────────────────────────────────── │
│ Abrir pasta/editor · tempo relativo [sempre]            │
│                    stg n/N [se PRs staging registrados]  │
│                    mst n/N [se PRs master registrados]   │
│                   status Jira [se não há objeto de PRs]  │
│ Ambiente dev [se existir e não estiver parado]          │
└──────────────────────────────────────────────────────────┘
```

O card não mostra contagem regressiva para a exclusão. O tempo relativo do rodapé é a atualização do arquivo, ou a criação se não houver atualização. `▂▃▅` mostra complexidade. `⚠` aparece para erro de agente/ambiente ou agente aguardando ação. Chips de PR mostram a quantidade mesclada e `✓` quando todos foram mesclados; o status Jira fica oculto quando há objeto de PRs. Uma execução de etapa anterior que ainda esteja rodando por movimentação manual pode aparecer aqui.

**Fontes:** `server/workspace/worktree-lifecycle.ts`, `board-list.ts`, `card-update.ts`; `src/features/cards/ui/CardView.tsx`; `src/features/cards/integrations/jira.ts`.
