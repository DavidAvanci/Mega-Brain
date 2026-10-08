# 01 — A fazer

## Ao entrar na etapa

1. A mudança de status é gravada em `card.json`. Nenhum agente ou script automático é iniciado nesta etapa.
2. Se a movimentação foi feita na interface, não há status Jira mapeado para `A fazer`; logo, ela não solicita transição do chamado.
3. Um card novo nasce aqui com título, descrição, fluxo de complexidade e pasta própria. A sincronização com Jira é uma ação da **coluna** (controle Jira), não uma ação disparada por mover um card para cá.

## Contrato técnico

**Entrada por movimentação:** `moveCard(id, 'a-fazer')` envia `POST /api/workspace/update` com `{ name: id, status: 'a-fazer' }`. `updateCard` lê `CARD_DIR/card.json`, preserva título, descrição e fluxo e grava o novo status. `stageFor('a-fazer')` não encontra etapa; portanto não há `spawn`, `agent.json` novo nem arquivo de progresso da etapa. A chamada `transitionJiraStatus` retorna sem requisição porque não existe mapeamento Jira para esse status.

**Criação de card:** `POST /api/workspace` recebe `{ title, description, flow, name? }`. `createCard` cria a pasta `MB-NNN` ou uma pasta com `name`, e grava `card.json` com `status: 'a-fazer'`. `flow` inválido ou ausente vira `dificil`. A sincronização Jira da coluna consulta `/api/jira/ready` somente quando acionada; ela cria cards com a chave do chamado como pasta e fluxo `dificil`.

**Leitura posterior:** `GET /api/workspace` projeta os campos para a interface. Não existe avanço automático saindo de A fazer. O usuário precisa mover o card para outra etapa.

## Prompt enviado a agentes

Nenhum. Criar ou mover um card para `a-fazer` não chama `runStageAgent` nem `runClaudeItem`, portanto não há parâmetro `-p`/prompt de etapa. O controle Jira da coluna é uma operação de API, não um agente.

## Desenho do card fechado

```text
┌──────────────────────────────────────────────────────────┐
│ ID/pasta [sempre]      ⚠ [se atenção]  ▂▃▅ [sempre]    │
│ Título [sempre]                                          │
│ Agente + progresso [se agente rodando]                  │
│ Smart Diff em execução [se ativo]                       │
│ ──────────────────────────────────────────────────────── │
│ Abrir pasta/editor · tempo relativo [sempre]            │
│                                      PRs [se houver]      │
│                         ou status Jira [se não há PRs]   │
│ Ambiente dev [se existir e não estiver parado]          │
└──────────────────────────────────────────────────────────┘
```

O indicador `▂▃▅` mostra a complexidade simples, média ou difícil. O tempo usa a última atualização, ou a criação se não houver atualização. `⚠` aparece se houver erro de agente, erro de ambiente dev ou agente aguardando ação. Uma linha de agente só aparece enquanto está `rodando`; pode ser um agente autônomo herdado de outra interação. O progresso percentual e a barra dependem de dados de progresso, e cada agente em execução pode ser interrompido individualmente no modal do card. O status Jira no rodapé só aparece quando não existe objeto de PRs; havendo PRs, aparecem os chips `stg`/`mst` disponíveis.

**Fontes:** `server/workspace/card-folder.ts`, `card-update.ts`; `src/features/board/Column.tsx`; `src/features/cards/ui/CardView.tsx`; `src/boardFilters.ts`.
