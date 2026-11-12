# Checklist de correções do verificador do run-task-checklist

Data: 14/10/2026.

Objetivo: corrigir os resultados incorretos e reduzir o tempo de verificação do `run-task-checklist` do Mega Brain.

Referência: relato do card `migrar-delivery-rotas-em-andamento`, de 14/10/2026. O round 1 levou 704 s, embora os comandos somassem aproximadamente 4 s e a revisão do agente, 8 s. O resultado teve 1 check `passed`, 17 `skipped` e 2 `inconclusive`, encerrando o estágio com erro.

Este arquivo registra as ações propostas; os itens desmarcados não representam trabalho concluído.

## 1. Leitura e diagnóstico

- [x] Ler `scripts/commands/dev-stage.ts` e seus testes existentes (não havia teste específico de `dev-stage.ts`).
- [x] Ler `scripts/lib/verification-runner.ts` e seus testes existentes.
- [x] Ler `scripts/lib/verification-baseline.ts` e seus testes existentes.
- [x] Ler `scripts/lib/verification-report.ts` e seus testes existentes.
- [x] Ler `scripts/lib/verification-profile.ts` e seus testes existentes.
- [x] Ler `scripts/lib/packageManager.ts` e seus testes existentes.
- [x] Procurar `verification-round-1.json` e `project-command-runs.jsonl`; os artefatos do caso não estão disponíveis no workspace.

## 2. Regra de sucesso da verificação

- [x] Fazer `skipped` contar como neutro na decisão de sucesso em `dev-stage.ts`.
- [x] Considerar a verificação aprovada quando não houver checks `failed`, `environment` ou `inconclusive`.
- [x] Aprovar quando todos os checks forem `skipped`, informando claramente que nada foi validado.
- [x] Atualizar `verificationSummary` para refletir essa regra.
- [x] Adicionar testes de regressão para combinações de `passed` e `skipped`, todos `skipped` e bloqueio por `failed`, `environment` ou `inconclusive`.

## 3. Baselines desnecessárias

- [x] Em `runVerificationChecks`, não chamar `runIsolatedVerificationBaseline` quando `profile.commands` estiver vazio.
- [x] Garantir que projetos com apenas checks `skipped` não criem worktree nem instalem dependências para baseline.
- [x] Adicionar teste comprovando que um perfil sem comandos executáveis não prepara baseline.

## 4. Desempenho e limpeza das baselines

- [x] Reutilizar `lockfilesMatch`, de `packageManager.ts`, para comparar os lockfiles da base e do worktree do card.
- [x] Quando forem iguais, reaproveitar o `node_modules` do card por symlink no lugar da instalação isolada.
- [x] Executar instalação isolada quando os lockfiles forem diferentes.
- [x] Preparar as baselines dos projetos em paralelo com `Promise.all`, antes do loop de comandos.
- [x] Preservar a limpeza dos worktrees no `finally`, inclusive em caso de erro.
- [x] Garantir que a limpeza remova o symlink sem seguir seu destino nem apagar o `node_modules` original.
- [x] Adicionar teste comprovando que lockfiles iguais não executam instalação.
- [x] Cobrir instalação com lockfiles diferentes e limpeza segura, inclusive em falhas.

## 5. Caminhos com symlink nos diagnósticos

- [x] Em `parseEslintDiagnostics`, aplicar `realpathSync` ao `cwd` e ao `filePath`, quando existir, antes de calcular o caminho relativo.
- [x] Aplicar a mesma normalização ao parser do Biome em `parseAdapterDiagnostics`.
- [x] Normalizar também `baselineRoot` em `dev-stage.ts` e `project.path`/`cwd` ao montar o perfil.
- [x] Adicionar teste com diretório temporário, `cwd` via symlink e diagnóstico ESLint apontando para o caminho real.
- [x] Cobrir o comportamento equivalente do parser do Biome.

## 6. Escopo de lint e exclusões

- [x] Em `verification-profile.ts`, identificar alvos explícitos no script `lint`, como `eslint src`.
- [x] Enviar ao ESLint apenas arquivos alterados dentro desses alvos.
- [x] Registrar os arquivos excluídos no resumo do check, sem tratá-los como falha.
- [x] Excluir arquivos sem código, como PNG e SVG, dos checks ESLint e Biome.
- [x] Excluir arquivos gerados, como `routeTree.gen.ts`, dos checks ESLint e Biome.
- [x] Adicionar teste para `eslint src`, incluindo arquivo em `src/` e arquivo de teste fora desse alvo.
- [x] Cobrir as exclusões de imagens e arquivos gerados.

## 7. Validação e entrega

- [x] Rodar os testes de regressão do verificador e das áreas afetadas; comparar a suíte completa antes e depois das correções.
- [x] Rodar a suíte completa do projeto. Execução final de `npm test`: **166 arquivos passaram; 838 testes passaram, 10 foram ignorados e nenhum falhou**. A execução inicial registrou as falhas que foram corrigidas.
- [x] Rodar o build do runtime: `npm run build` terminou com código 0 (`tsc -b` e `vite build`; 6783 módulos transformados).
- [x] Registrar os comandos executados e resultados: `npm test` (**166 arquivos aprovados; 838 testes aprovados, 10 ignorados**), `npx vitest run --pool=forks --poolOptions.forks.singleFork scripts/lib/verification-report.test.ts scripts/lib/verification-profile.test.ts scripts/lib/verification-baseline.test.ts scripts/lib/verification-baseline-dependencies.test.ts scripts/lib/verification-baseline-cleanup.test.ts scripts/lib/verification-runner.test.ts` (**6 arquivos, 18 testes aprovados**), `npx tsc -b` (código 0) e `npm run build` (código 0; 6783 módulos transformados).
- [x] Conferir que o resumo distingue checks aprovados, ignorados e impeditivos.
- [x] Conferir que perfis sem comandos não preparam baseline e que baselines com lockfiles iguais não executam instalação.
- [x] Não editar `~/.local/share/mega-brain/runtime/`, pois esse diretório é gerado pelo build.
- [x] Declarar a implementação concluída após confirmar os testes passando e o build bem-sucedido.

Gate final aprovado: a suíte completa passou, `npx tsc -b` terminou com código 0 e `npm run build` terminou com código 0.
