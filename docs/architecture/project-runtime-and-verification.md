# Runtime do projeto e verificação de Tasks

## Contextos de Node

O Node que executa o servidor Mega Brain e o Node de uma CLI (Claude/Codex) são independentes do runtime usado pelos comandos do projeto. Para selecionar o runtime do projeto, o resolver considera, nesta ordem: `nodeRuntime.override` no catálogo, `.nvmrc`, `.node-version` e `engines.node` do `package.json`. No WSL/Linux ele procura versões já instaladas em NVM e no `PATH`; não executa `nvm install` nem baixa versões. `engines.node` também precisa aceitar o binário selecionado.

Uma versão exata ausente bloqueia a execução. A política `same-major-fallback` permite um patch disponível da mesma major somente quando ele também satisfaz `engines.node`; o aviso, versão e caminho ficam registrados na tentativa. Sem requisito explícito, o resolver usa o Node encontrado pelo PATH do processo (incluindo o PATH de login no WSL) e só recorre ao Node do servidor se não houver um comando `node` disponível. Essa política pode ser substituída no catálogo do repositório.

O launcher `scripts/commands/project-command.ts` executa argv sem shell, com PATH próprio, timeout e captura de saída. O scheduler também antepõe o Node resolvido ao PATH do processo da CLI; o próprio binário Claude/Codex é selecionado antes dessa alteração. Scripts do gerenciador herdam o PATH por invocação.

## Dependências e ambientes dev

Instalações usam `npm ci`, `pnpm install --frozen-lockfile`, ou Yarn imutável quando existe lockfile. Yarn classic usa `--frozen-lockfile`. Worktrees removem links de `node_modules` incompatíveis antes de instalar, e a instalação ocorre na worktree. Dependências compartilhadas são reutilizadas quando lockfiles e runtime são compatíveis. Yarn PnP não exige `node_modules`.

Builds e servidores do ambiente dev resolvem runtime para cada diretório de projeto. O PATH de login WSL é preservado como base, com o binário selecionado à frente. Nenhum passo muda a instalação global do Node.

## Perfil e estado de verificação

`verification-profile.json` representa comandos descobertos a partir de scripts do repositório e configuração relevante. Seu fingerprint inclui configuração, lockfile, gerenciador e runtime. `VerificationReport` usa estados `passed`, `failed`, `skipped`, `environment` e `inconclusive`; apenas falhas classificadas como código, com arquivos atribuídos, podem gerar reparo.

O pipeline de verificação está temporariamente desabilitado no scheduler (`verificationEnabled = false`). Enquanto desligado, não há baseline, checks de projeto, reparos automáticos, formatação nem agente verificador. Um item `done` significa implementação integrada pelo scheduler; não significa que lint, build ou testes foram executados.

## Baseline, reparos e resultados

O escopo vem do diff entre a base original do card (quando registrada) e o HEAD integrado. Arquivos apagados não são passados ao check; renomes mantêm o caminho anterior para comparação. A baseline roda em worktree Git temporária, com instalação própria e o mesmo runtime. Diagnósticos são comparados como multiconjunto de repo, arquivo, regra e mensagem. Se instalação, perfil, configuração ou parsing não permitirem comparação, o resultado é `inconclusive`.

Adapters atuais: ESLint JSON, Prettier `--check` e Biome 2 JSON. Scripts gerais de teste, build e typecheck ficam `skipped` porque não oferecem escopo seguro por arquivo. Somente diagnóstico novo atribuído a arquivo do card pode criar reparo. Reparos persistem origem, fingerprint, perfil, rodada e diagnósticos; repetição de reparo pendente é vinculada ao item existente e repetição após conclusão interrompe a rodada como sem progresso. O comando vem do perfil e roda de novo no escopo autorizado antes do commit. Formatação usa Prettier ou `biome format --write`, em worktree da task, somente com `megaBrain.verification.formatWholeFiles: true`.

Cada execução de check gera telemetria JSONL sem stdout/stderr, junto com relatório versionado por rodada contendo status, duração, ambiente e contagens. Relatórios usam gravação atômica. Sem dados de custo do provider, o custo continua indisponível. `skipped`, `environment` e `inconclusive` não equivalem a aprovação.

## Estado e ativação futura

O pipeline, incluindo baseline, checks, reparos e formatação, está temporariamente desligado no scheduler (`verificationEnabled = false`). Reativá-lo exige corrigir e revisar o fluxo de verificação. Runtime por projeto e dependências isoladas continuam ativos para os executores.

Para reativar, ligue o gate do pipeline somente após corrigir e revisar o fluxo. Runtime por projeto e dependências isoladas continuam ativos independentemente da verificação.
