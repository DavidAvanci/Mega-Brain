# 08 — Aguardando deploy

## Ao entrar na etapa

1. O status é salvo e inicia `master-pr-task`, se não houver outra execução ativa. Em movimentação feita pela interface, um card Jira válido tenta mudar o chamado para `AGUARDANDO DEPLOY`.
2. Para cada repositório vinculado, o script confere a feature branch e a worktree limpa, busca o remoto, verifica commits exclusivos da tarefa, envia a branch e reutiliza ou cria PR para a branch padrão (ou base indicada). Se o PR tiver conflito, tenta rebase/resolução automática e reenvia com `--force-with-lease`.
3. Registra os links dos PRs master em `card.json`. Com chave e configuração Jira, comenta os PRs. Se estiver **dentro da janela de deploy**, tenta pôr o chamado em `STAGING`; fora dela, em `AGUARDANDO DEPLOY` e comenta o próximo horário. Essa ação do script pode, portanto, produzir status Jira diferente da transição inicial feita pela interface.
4. A coluna mostra no **cabeçalho** se a janela de deploy está aberta ou a próxima janela. O script não faz deploy nem move automaticamente o card para Produção. A fase de progresso do agente é “Abrindo PRs de master”.

## Contrato técnico

**Processo de etapa:** ao gravar `status: 'aguardando-deploy'`, `stageFor` seleciona `master-pr-task`. Em código fonte, `spawn(MEGA_ROOT/node_modules/.bin/tsx, [MEGA_ROOT/scripts/commands/master-pr.ts, CARD_DIR])`; no bundle, `spawn(NODE, [runtime.mjs, CARD_DIR])` com `MEGA_BRAIN_STAGE_SCRIPT=master-pr-task`. `cwd=CARD_DIR`; stdout vai para `master-pr-task.jsonl`, stderr para `master-pr-task.log`, e PID/etapa para `agent.json`. O caminho normal usa Git e `gh`, sem agente Claude/Codex. Um conflito de rebase pode acionar o resolvedor automático.

**Entradas:** `taskInfo` usa `card.json` e `PLAN.md` para identificar ID, título, tipo e possível chave Jira. `repoLinks` fornece as worktrees. O corpo do PR usa a seção “O que foi feito” do plano quando disponível. A base é a branch padrão de cada repo; `--base <repo>=<branch>` é aceito em invocação manual, mas não é passado pelo lançamento automático. `--draft` também é opcional apenas em invocação manual.

**Comandos Git/GitHub por repo:** exige feature branch e worktree limpa, faz `git fetch origin`, verifica commits em `origin/<BASE>..<FEATURE>` e evita commits de outras tarefas já presentes em staging. Depois executa `git push -u origin <FEATURE>`, consulta PR existente ou roda `gh pr create --base <BASE> --head <FEATURE> --title ... --body ...`. Se o PR indicar conflito, tenta `git rebase origin/<BASE>` com resolução automática, `git push -u origin <FEATURE> --force-with-lease` e nova checagem de conflito.

**Desvio de conflito:** se o rebase falhar por conflito, `resolveRebaseConflict` chama `runClaudeItem` com `cwd=<WORKTREE_DO_REPO>`, prompt para concluir o rebase, `tools=Bash,Read,Edit,Write` e timeout de 15 minutos. O executor escolhe Claude ou Codex conforme `MEGA_BRAIN_LLM_PROVIDER` e recebe `CHECKLIST_MODEL`/`CHECKLIST_EFFORT` herdados da etapa; o formato da CLI está em [Desenvolvendo](04-desenvolvendo.md). Após o agente, o script exige worktree limpa e retorno à feature branch. Se a resolução falhar, tenta `git rebase --abort` e registra o erro do repo.

**Saídas e janela:** `mergeCardPrs` grava `prs.master[repo] = URL` em `card.json`. `nextDeploySlot()` consulta a janela de deploy. Com Jira configurado, o script comenta os PRs e tenta `STAGING` se a janela estiver aberta, ou `AGUARDANDO DEPLOY` com comentário sobre o próximo horário se estiver fechada. `finish` exige PR para cada repo e ausência de erros. Não há avanço automático para Produção nem comando de deploy; a janela no cabeçalho da coluna é calculada pela interface separadamente.

## Prompt enviado ao agente, somente se houver conflito

O script normal de PR não tem prompt. Quando `git rebase origin/<BASE>` falha por conflito, `resolveRebaseConflict` monta **este texto literal**, com `<REPO>`, `<FEATURE_BRANCH>` e `<BASE>` substituídos pelos valores do repo:

```text
Resolva o conflito Git no repositório <REPO>. Há um rebase em conflito da branch <FEATURE_BRANCH> sobre origin/<BASE>.
Trabalhe somente nos arquivos que fazem parte do conflito e preserve as duas intenções quando forem compatíveis.
Inspecione os marcadores de conflito e o histórico antes de editar. Rode a validação mais específica e viável para os arquivos alterados.
Conclua o rebase com `git rebase --continue`. Não use --no-verify, não use git reset/checkout para descartar trabalho, não use git cherry-pick --abort/--skip nem git rebase --abort/--skip.
Não faça push, não crie PR e não altere arquivos sem relação com o conflito.
Se a resolução exigir uma decisão de produto ou você não conseguir validar, pare sem inventar uma solução e retorne status blocked.
```

`runClaudeItem` passa o texto em `-p` para Claude, com `cwd` na worktree. Para Codex, o executor acrescenta **duas quebras de linha** e este sufixo literal:

```text
Ao terminar, responda somente com JSON válido no formato {"status":"done|failed|blocked","note":"resumo curto"}.
```

## Desenho do card fechado

```text
┌──────────────────────────────────────────────────────────┐
│ ID/pasta [sempre]      ⚠ [se atenção]  ▂▃▅ [sempre]    │
│ Título [sempre]                                          │
│ Agente master + %/barra [se rodando e há progresso]     │
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

O estado da janela de deploy **não está dentro do card**; fica no cabeçalho da coluna. Chips `stg`/`mst` exibem contagem de PRs mesclados e `✓` quando todos foram mesclados. O status Jira só aparece se não houver objeto de PRs. `⚠` sinaliza erro de agente/ambiente ou agente aguardando ação. O agente concluído deixa de aparecer; o tempo e o botão de pasta/editor permanecem.

**Fontes:** `scripts/commands/master-pr.ts`; `shared/lib/deploy-window.ts`; `src/features/board/Column.tsx`; `src/features/cards/ui/CardView.tsx`; `src/features/cards/integrations/jira.ts`.
