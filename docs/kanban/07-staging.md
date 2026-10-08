# 07 — Staging

## Ao entrar na etapa

1. O status é salvo e inicia `stage-task`, se não houver outra execução ativa. Em movimentação feita pela interface, um card Jira válido também tenta mudar o chamado para `STAGING`.
2. O script percorre os repositórios vinculados ao card. Confere a feature branch, registra em commit alterações ainda não commitadas quando está nessa branch, busca o remoto e envia a feature branch. Cria uma branch de staging a partir de `origin/staging`, aplica por cherry-pick os commits da tarefa e tenta resolver conflitos. Envia a branch e reutiliza ou abre um PR para `staging` por repositório.
3. Registra os links dos PRs de staging em `card.json`. Quando há chave e configuração Jira, publica ou atualiza comentário com os PRs e tenta mover o chamado para `CODE REVIEW`. Falhas parciais são registradas; a etapa só conclui sem erro se todos os repositórios produzirem PR e não restarem erros.
4. O término do script **não move o card** para Aguardando deploy. Essa movimentação é manual. O indicador de progresso da etapa usa uma fase única (“Abrindo PRs de staging”).

## Contrato técnico

**Processo de etapa:** `POST /api/workspace/update` grava `status: 'staging'`. `stageFor` seleciona `stage-task`. Em código fonte, o backend inicia `spawn(MEGA_ROOT/node_modules/.bin/tsx, [MEGA_ROOT/scripts/commands/stage.ts, CARD_DIR])`; no bundle, `spawn(NODE, [runtime.mjs, CARD_DIR])` com `MEGA_BRAIN_STAGE_SCRIPT=stage-task`. `cwd` é `CARD_DIR`. O processo escreve stdout em `stage-task.jsonl`, stderr em `stage-task.log` e PID/etapa em `agent.json`. **Nenhum agente Claude/Codex é iniciado no caminho normal**; um resolvedor automático de conflitos pode recorrer a um agente se houver conflito no cherry-pick.

**Entradas:** `taskInfo(CARD_DIR)` lê `card.json` (título) e `PLAN.md` (tipo/issue); `repoLinks(CARD_DIR)` encontra os links de worktrees em `repos/` ou no layout antigo. A seção “O que acontecia” e “O que foi feito” de `PLAN.md`, quando existem, compõe o corpo do PR. A feature branch é derivada da tarefa; a base de staging é `origin/staging`. O script entende `--draft` quando invocado manualmente, mas a entrada automática não passa essa flag.

**Comandos Git/GitHub por repo:** verifica branch e alterações (`git status --porcelain`), faz `git add -A` e commit final se necessário, `git fetch origin`, lista os commits próprios com `git rev-list --reverse --no-merges origin/<BASE>..<FEATURE>` e envia `<FEATURE>`. Em seguida faz `git checkout -B <BRANCH_STAGING> origin/staging`, aplica `git cherry-pick <COMMITS>` com `rerere` e resolução de conflitos, envia a branch com `git push -u origin <BRANCH_STAGING> --force-with-lease`, volta à feature branch e usa um PR existente ou `gh pr create --base staging --head <BRANCH_STAGING> --title ... --body ...`.

**Desvio de conflito:** `resolveCherryPickConflict` primeiro tenta avançar deterministicamente um cherry-pick vazio ou já resolvido. Se restarem arquivos em conflito, chama `runClaudeItem` com `cwd=<WORKTREE_DO_REPO>`, prompt para resolver o cherry-pick, `tools=Bash,Read,Edit,Write` e timeout de 15 minutos. O executor escolhe Claude ou Codex conforme `MEGA_BRAIN_LLM_PROVIDER`, usando os argumentos de agente de item descritos em [Desenvolvendo](04-desenvolvendo.md), com `CHECKLIST_MODEL`/`CHECKLIST_EFFORT` herdados da etapa. Depois confere que o sequenciador terminou, a worktree está limpa e todos os commits esperados foram aplicados.

**Saídas:** `mergeCardPrs` grava `prs.staging[repo] = URL` em `card.json`. Com Jira configurado, `upsertComment` publica os links e o script tenta transicionar o chamado para `CODE REVIEW`. `finish` registra sucesso somente se todos os repositórios gerarem PR e não houver erros. Mesmo com sucesso, não há `next` em `STAGES`/`FLOW_PROFILES` para esta etapa: o card permanece em Staging.

## Prompt enviado ao agente, somente se houver conflito

O script normal de PR não tem prompt. Se o cherry-pick ficar em conflito após as tentativas determinísticas, `resolveCherryPickConflict` monta **este texto literal** em `scripts/lib/conflictResolver.ts`, substituindo apenas `<REPO>`:

```text
Resolva o conflito Git no repositório <REPO>. Há um cherry-pick em conflito já iniciado.
Trabalhe somente nos arquivos que fazem parte do conflito e preserve as duas intenções quando forem compatíveis.
Inspecione os marcadores de conflito e o histórico antes de editar. Rode a validação mais específica e viável para os arquivos alterados.
Conclua o cherry-pick com `git cherry-pick --continue`. Não use --no-verify, não use git reset/checkout para descartar trabalho, não use git cherry-pick --abort/--skip nem git rebase --abort/--skip.
Não faça push, não crie PR e não altere arquivos sem relação com o conflito.
Se a resolução exigir uma decisão de produto ou você não conseguir validar, pare sem inventar uma solução e retorne status blocked.
```

`<REPO>` é o alias do repositório vinculado ao card. `runClaudeItem` passa esse texto a Claude em `-p`, com `cwd` na worktree do repo. Se o provedor é ChatGPT, acrescenta **duas quebras de linha** e o sufixo literal:

```text
Ao terminar, responda somente com JSON válido no formato {"status":"done|failed|blocked","note":"resumo curto"}.
```

## Desenho do card fechado

```text
┌──────────────────────────────────────────────────────────┐
│ ID/pasta [sempre]      ⚠ [se atenção]  ▂▃▅ [sempre]    │
│ Título [sempre]                                          │
│ Agente staging + %/barra [se rodando e há progresso]    │
│ Outros agentes rodando [se houver]                       │
│ Smart Diff em execução [se ativo]                       │
│ ──────────────────────────────────────────────────────── │
│ Abrir pasta/editor · tempo relativo [sempre]            │
│                    stg n/N [se PRs staging registrados]  │
│                    mst n/N [se PRs master registrados]   │
│                   status Jira [se não há objeto de PRs]  │
│ Ambiente dev [se existir e não estiver parado]          │
└──────────────────────────────────────────────────────────┘
```

O chip de PR é aberto pelo clique e mostra quantos links estão mesclados; `✓` substitui `n/N` quando todos estão mesclados. Um PR só aparece após seu link ser salvo; durante a execução pode não haver chip ainda. `▂▃▅` indica complexidade. `⚠` cobre erro de agente ou ambiente e agente aguardando ação. A linha do agente some ao concluir, mesmo que os chips de PR permaneçam. O tempo e a ação de pasta/editor aparecem sempre.

**Fontes:** `scripts/commands/stage.ts`; `server/workspace/stage-catalog.ts`, `card-record.ts`; `src/features/cards/ui/CardView.tsx`; `src/features/cards/integrations/jira.ts`.
