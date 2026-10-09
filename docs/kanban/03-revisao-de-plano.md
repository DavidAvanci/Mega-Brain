# 03 — Revisão de plano

## Ao entrar na etapa

1. O status é salvo. Não há script nem agente automático associado à entrada nesta etapa. Ela é um ponto de revisão humana do plano e da checklist; o avanço para Desenvolvendo depende de uma movimentação do card.
2. Os fluxos **médio** e **difícil** chegam aqui após o planejamento bem-sucedido. O fluxo **simples** normalmente pula esta coluna. Como a interface permite mover para qualquer coluna, um card simples pode ser colocado aqui manualmente.
3. Não há transição Jira mapeada para esta etapa ao mover pela interface.

## Contrato técnico

**Entrada:** o servidor pode gravar `status: 'revisao-de-plano'` em `card.json` por `advanceStage` quando `task-planning` conclui e `flow` é `medio` ou `dificil`. Uma movimentação manual envia `POST /api/workspace/update` com `{ name: CARD_ID, status: 'revisao-de-plano' }` e grava o mesmo campo.

**Processo e entradas:** `stageFor('revisao-de-plano')` retorna `undefined`. Não há CLI, `spawn`, prompt ou arquivo de log desta etapa. A revisão usa os arquivos que o planejamento já produziu em `CARD_DIR`: `PLAN.md` e `TASK-CHECKLIST.md`. Abrir o modal consulta esses artefatos por `GET /api/workspace/detail`; a entrada na coluna não os relê para validá-los.

**Saída:** não há evento automático que leve a Desenvolvendo. Só uma movimentação de status inicia `run-task-checklist`. Nenhuma transição Jira é mapeada para esta coluna.

## Prompt enviado a agentes

Nenhum ao entrar em Revisão de plano. `stageFor('revisao-de-plano')` não define agente nem script. Os arquivos `PLAN.md` e `TASK-CHECKLIST.md` podem ser lidos por uma pessoa no modal, mas não são enviados automaticamente a uma CLI nesta etapa.

## Desenho do card fechado

```text
┌──────────────────────────────────────────────────────────┐
│ ID/pasta [sempre]      ⚠ [se atenção]  ▂▃▅ [sempre]    │
│ Título [sempre]                                          │
│ Agentes rodando + progresso [se houver]                  │
│ Smart Diff em execução [se ativo]                       │
│ ──────────────────────────────────────────────────────── │
│ Abrir pasta/editor · tempo relativo [sempre]            │
│                                      PRs [se houver]      │
│                         ou status Jira [se não há PRs]   │
│ Ambiente dev [se existir e não estiver parado]          │
└──────────────────────────────────────────────────────────┘
```

`▂▃▅` representa o fluxo escolhido. O card fechado não mostra o texto do plano nem da descrição; eles ficam no modal de detalhes. `⚠` sinaliza erro de agente ou ambiente ou agente aguardando ação. Agentes concluídos não aparecem nessa faixa. Se um agente automático de outra etapa ainda estiver rodando por movimentação manual, sua linha e controle de interrupção podem continuar visíveis. O tempo é relativo à atualização ou criação. PRs e ambiente dev são dados persistentes e podem aparecer aqui se já existirem.

**Fontes:** `server/workspace/stage-catalog.ts`, `stage-transition.ts`, `card-update.ts`; `src/features/cards/ui/CardView.tsx`.
