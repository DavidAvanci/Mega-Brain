# 05 — Auto Testing

## Ao entrar na etapa

1. O status é salvo e inicia `run-test-checklist`, se não houver outra execução ativa. O fluxo **difícil** chega aqui automaticamente após Desenvolvendo; os fluxos simples/médio normalmente pulam a etapa. Não há transição Jira mapeada para Auto Testing na interface.
2. O script exige `TEST-CHECKLIST.md`, prepara a pasta de screenshots e sobe o ambiente local se ele ainda não estiver rodando. Se for preciso escolher um frontend, usa a primeira opção apresentada. Aguarda o ambiente ficar pronto por até 15 minutos; erro ou timeout falham a etapa.
3. Executa até **três cenários em paralelo** com agentes Claude. Cada cenário recebe o endereço do app, instruções de Playwright e caminho dos screenshots. Credenciais de teste são passadas ao processo quando estão disponíveis. O resultado de cada cenário atualiza a checklist.
4. O progresso visível vem das caixas de `TEST-CHECKLIST.md`. Com sucesso, a próxima leitura do quadro move o card para **Code Review**. Falhas e bloqueios mantêm o card em Auto Testing e geram atenção.

## Contrato técnico

**Processo de etapa:** ao mudar o status para `auto-testing`, `stageFor` seleciona `run-test-checklist`. Em código fonte, `spawn(MEGA_ROOT/node_modules/.bin/tsx, [MEGA_ROOT/scripts/commands/test-stage.ts, CARD_DIR])`; no bundle, `spawn(NODE, [runtime.mjs, CARD_DIR])` com `MEGA_BRAIN_STAGE_SCRIPT=run-test-checklist`. `cwd` é `CARD_DIR`; stdout, stderr e metadados vão para `run-test-checklist.jsonl`, `run-test-checklist.log` e `agent.json`.

**Entradas e ambiente:** o script exige `CARD_DIR/TEST-CHECKLIST.md`, reinicia marcações falhas/bloqueadas e cria `CARD_DIR/screenshots`. `ensureEnv` lê o estado do ambiente dev; se necessário chama `startDevEnv(CARD_DIR)`, seleciona o primeiro frontend quando a API pede escolha, aguarda até 15 minutos e coleta as URLs dos apps. Para cada cenário, busca `TEST_LOGIN_EMAIL` e `TEST_LOGIN_PASSWORD` do ambiente local do repositório quando disponíveis; os valores são passados ao processo do agente e não entram no prompt.

**Agentes de cenário:** `runChecklist({ max: 3 })` chama `runClaudeItem` para cada item pronto. O prompt combina `prompts.testItem`, `Cenário: <ID> — <TEXTO>`, detalhes, repo/URL, sessão `playwright-cli -s=<ID>` e destino `screenshots/<ID>-<passo>.png`. O `cwd` é `CARD_DIR`, o timeout é **12 minutos por cenário**, o modelo padrão é `sonnet` e esforço padrão `low`. Para Claude, os argumentos são os mesmos da execução de item de desenvolvimento, mas `--tools Bash,Read`; para ChatGPT, `codex exec --json --dangerously-bypass-approvals-and-sandbox [--model] [--config model_reasoning_effort=...] <PROMPT+INSTRUÇÃO_JSON>`. O executor acrescenta o requisito de retorno JSON `{ status, note }`.

**Saída e avanço:** as marcas e notas são gravadas em `TEST-CHECKLIST.md`, screenshots podem ser criados na pasta indicada, e o script emite um resultado agregado no JSONL. `checklistProgress` lê as caixas do arquivo. Em `GET /api/workspace`, `advanceStage` escreve `code-review` apenas se a etapa concluiu; não inicia outro script nessa coluna.

## Prompt enviado a cada agente de cenário

O processo `test-stage.ts` não recebe prompt. Para cada item de `TEST-CHECKLIST.md`, `buildPrompt` usa `<TEST_ITEM>` igual ao texto literal de [testItem padrão](prompts/test-item-default.txt), ou a string não vazia `prompts.testItem` do JSON em `MEGA_BRAIN_SETTINGS_FILE`. O texto enviado ao Claude em `-p` é exatamente este molde, com `\n` entre as linhas:

```text
<TEST_ITEM>

Cenário: <ITEM_ID> — <TEXTO_DO_CENÁRIO>
  <DETALHE_1>
  <DETALHE_N>
App: <REPO> — <URL_LOCAL>
Sessão playwright: use sempre playwright-cli -s=<ITEM_ID>
Screenshots: salve em <CARD_DIR>/screenshots/<ITEM_ID>-<passo>.png
Login: se a tela pedir autenticação, use TEST_LOGIN_EMAIL e TEST_LOGIN_PASSWORD disponíveis no ambiente do processo. Nunca mostre nem registre seus valores.
Ao abrir o app podem aparecer modais de aviso empilhados: feche todos (botão "Ok, entendi" ou o X) antes de começar o cenário.
```

Os detalhes vêm das linhas subordinadas ao item da checklist e são omitidos quando ausentes. Se não houver URL, a linha fica literalmente `App: <REPO>`, sem ` — ...`. A linha `Login: ...` aparece **somente** quando `credentialsFromEnvironment` encontrou as duas credenciais; seus valores são variáveis de ambiente do processo e nunca são interpolados nesse texto. No Codex, `runClaudeItem` acrescenta depois de duas quebras de linha o sufixo literal abaixo; no Claude, a forma de retorno é exigida por `--json-schema`:

```text
Ao terminar, responda somente com JSON válido no formato {"status":"done|failed|blocked","note":"resumo curto"}.
```

## Desenho do card fechado

```text
┌──────────────────────────────────────────────────────────┐
│ ID/pasta [sempre]      ⚠ [se atenção]  ▂▃▅ [sempre]    │
│ Título [sempre]                                          │
│ Agente testes + %/barra [se rodando e há progresso]     │
│ Outros agentes rodando [se houver]                       │
│ Smart Diff em execução [se ativo]                       │
│ ──────────────────────────────────────────────────────── │
│ Abrir pasta/editor · tempo relativo [sempre]            │
│                                      PRs [se houver]      │
│                         ou status Jira [se não há PRs]   │
│ Ambiente dev [se estiver subindo, rodando ou em erro]    │
└──────────────────────────────────────────────────────────┘
```

`▂▃▅` mostra a complexidade. O ambiente dev, iniciado pelo script, pode exibir fase de subida, apps e URLs, avisos, erro e ações de parar ou tentar novamente. O card só mostra essa área se o ambiente não estiver parado. `⚠` aparece para erro de agente/ambiente ou agente aguardando ação. O tempo usa a atualização ou criação; status Jira só aparece na ausência de objeto de PRs. Informações antigas de PR podem persistir.

**Fontes:** `scripts/commands/test-stage.ts`; `server/workspace/stage-catalog.ts`, `stage-transition.ts`; `src/features/dev-environments/DevEnvPanel.tsx`; `src/features/cards/ui/CardView.tsx`.
