# 06 — Code Review

## Ao entrar na etapa

1. O status é salvo. Não há script automático associado a Code Review. A etapa recebe automaticamente cards cujo desenvolvimento (simples/médio) ou Auto Testing (difícil) terminou com sucesso. A revisão e a movimentação seguinte são manuais.
2. Se a entrada foi feita pela interface e a pasta é uma chave Jira válida, a interface tenta mudar o chamado para `CODE REVIEW`. A passagem automática feita pelo servidor não faz essa chamada.
3. O card **sempre oferece o botão “Iniciar ambiente dev”** quando não há ambiente ativo. Iniciar o ambiente depende de um clique; entrar na etapa, por si só, não o inicia. Se o ambiente já estiver ativo, aparecem seu estado e controles. Um PR aberto conhecido pode acender o aviso de atenção.

## Contrato técnico

**Entrada:** `advanceStage` escreve `status: 'code-review'` em `card.json` depois de `run-task-checklist` ou `run-test-checklist` concluir, conforme `flow`. Se a mudança é manual, a interface envia `POST /api/workspace/update` com `{ name: CARD_ID, status: 'code-review' }` e, para uma chave Jira válida, chama `POST /api/jira/transition` com `CODE REVIEW`. O avanço pelo servidor não faz essa requisição Jira.

**Processo:** `stageFor('code-review')` retorna `undefined`; não há `spawn`, CLI ou prompt por entrada na coluna. O modal abre inicialmente a aba Diff nessa etapa. Ela consulta `GET /api/workspace/diff` para ler uma revisão salva e, se não houver, `GET /api/workspace/diff/standard` para mostrar o diff Git. **Gerar Smart Diff** exige clicar no botão, que envia `POST /api/workspace/diff` e pode então executar a ferramenta Smart Diff e um agente Claude/Codex. `Iniciar ambiente dev` também exige clique (`POST /api/workspace/dev-env`).

**Saída:** não há transição automática após revisão ou merge de PR. Mover para Staging é uma ação do usuário que inicia `stage-task`.

## Prompts de ações opcionais no card

**Entrar na coluna:** nenhum prompt é enviado. Abrir a aba Diff apenas lê uma revisão salva ou o diff Git. Se o usuário clicar em **Gerar Smart Diff**, o backend constrói um prompt a partir do texto literal de [smartDiffReview padrão](prompts/smart-diff-review-default.txt), ou de `prompts.smartDiffReview` configurado. Primeiro substitui **todas** as ocorrências de `<script-de-revisao>` pelo caminho real de `smart-diff-review-cli.mjs`. Em prompts personalizados já salvos, também converte a antiga frase sobre a skill e o marcador `<dir-da-skill>/review.mjs`. Em seguida acrescenta, com uma quebra de linha entre elementos:

```text
Os relatórios já foram gerados contra a branch padrão remota de cada repositório. Não execute o Smart Diff novamente.
Para cada relatório, rode prepare, leia todos os patches, escreva as decisões em decisions.json e rode assemble até validar.
Use o cache indicado. Não edite o JSON final à mão. Trabalhe somente nos arquivos dentro da pasta do card.
Pasta do card: <CARD_DIR>
Repositório <REPO_1> (base origin/<BASE_1>): report=<REPORT_1>; saída=<OUTPUT_1>; cache=<CACHE_1>; trabalho=<DIR_OUTPUT_1>
Repositório <REPO_N> (base origin/<BASE_N>): report=<REPORT_N>; saída=<OUTPUT_N>; cache=<CACHE_N>; trabalho=<DIR_OUTPUT_N>
```

Há uma linha `Repositório ...` por repo processado. O texto final é passado a `claude -p <PROMPT> --dangerously-skip-permissions` ou `codex exec --dangerously-bypass-approvals-and-sandbox <PROMPT>`; esse caminho **não** acrescenta o sufixo JSON usado pelos agentes de checklist.

Se o ambiente dev estiver em erro, o botão **Rodar com agente** abre um terminal com o texto literal de [testEnvironment padrão](prompts/test-environment-default.txt), ou `prompts.testEnvironment` configurado. Esse prompt é passado diretamente, sem dados do card acrescentados pelo código, a `claude --model haiku --dangerously-skip-permissions <PROMPT>` ou `codex --dangerously-bypass-approvals-and-sandbox <PROMPT>`. Essa ação pode aparecer também em outras colunas quando o card carrega um ambiente dev em erro.

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
│ Iniciar ambiente dev [se ausente ou parado]              │
│ OU estado/apps/URLs/ações [se ambiente ativo ou em erro] │
└──────────────────────────────────────────────────────────┘
```

`⚠` pode representar erro de agente/ambiente, agente aguardando ação ou PR com estado `open` nesta coluna. `▂▃▅` indica o fluxo. O chip de PR mostra `stg` ou `mst` com quantidade mesclada/total e marca de conclusão quando todos foram mesclados; esses chips só aparecem se os links estiverem registrados. A linha Jira aparece apenas quando não há objeto de PRs. Agentes concluídos não ocupam a faixa de execução. Tempo e botão de pasta/editor aparecem sempre.

**Fontes:** `server/workspace/stage-catalog.ts`, `stage-transition.ts`; `src/features/cards/ui/CardView.tsx`; `src/features/dev-environments/DevEnvPanel.tsx`; `src/boardFilters.ts`; `src/features/cards/integrations/jira.ts`.
