# 06 — Code Review

## Ao entrar na etapa

A Auto Review já executou o agente Revisor e salvou `diff.json`. Code Review é a etapa de inspeção humana e ações manuais. Abrir o card permite consultar o relatório salvo e o diff Git padrão. Mover manualmente para esta coluna não inicia outra revisão.

Se a entrada foi feita pela interface e a pasta é uma chave Jira válida, a interface tenta mudar o chamado para `CODE REVIEW`. O avanço automático feito pelo servidor não chama a transição Jira. O card oferece **Iniciar ambiente dev** quando não há ambiente ativo; o clique inicia o ambiente.

## Reexecutar a revisão

Mover o card para Auto Review inicia uma nova execução do agente Revisor. Se a execução concluir com sucesso, o servidor grava `diff.json` e avança para Code Review. Em caso de falha, o card permanece em Auto Review e o erro fica disponível no estado do agente.

O prompt e o modelo do agente são configurados nas opções de agentes (`codeReview`). O agente lê diretamente o diff Git e os arquivos relevantes de cada repositório. Não há etapa nem dependência externa de Smart Diff.

## Desenho do card fechado

```text
┌──────────────────────────────────────────────────────────┐
│ ID/pasta [sempre]      ⚠ [se atenção]  ▂▃▅ [sempre]    │
│ Título [sempre]                                          │
│ Agentes em execução [se houver]                          │
│ ──────────────────────────────────────────────────────── │
│ Abrir pasta/editor · tempo relativo [sempre]            │
│                                      PRs [se houver]      │
│                         ou status Jira [se não há PRs]   │
│ Iniciar ambiente dev [se ausente ou parado]              │
└──────────────────────────────────────────────────────────┘
```

**Fontes:** `server/workspace/code-review.ts`, `server/workspace/card-update.ts`, `server/workspace/board-list.ts`, `src/features/cards/ui/CardView.tsx`.
