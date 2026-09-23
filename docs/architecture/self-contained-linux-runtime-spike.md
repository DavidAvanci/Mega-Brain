# Spike — runtime Linux autocontido

Data: 2026-09-03. Escopo: item exploratório da Fase 5. Este documento não
altera o supervisor, a forma de iniciar o backend nem o requisito atual de
Node no WSL.

## Decisão

**Não adotar um binário autocontido nesta versão.** Continuar distribuindo o
bundle JavaScript e exigindo Node 18.19+ no WSL.

Um executável que incorpore apenas o runtime do backend poderia eliminar
`node dist/server/main.mjs`, mas ainda não elimina Node da instalação: os
estágios dinâmicos usam `tsx` do checkout. Trocar isso silenciosamente por um
runtime empacotado mudaria a semântica dos scripts que o usuário mantém e não
foi demonstrado seguro. O bundle atual também contém ESM e APIs nativas de
Node; o Node 18.19 disponível não expõe uma opção SEA (`--experimental-sea-*`)
para produzir e testar esse candidato localmente.

## Evidências da inspeção

| Área              | Evidência                                                                                                                                                  | Consequência                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Backend           | `npm run server:build` gera `dist/server/main.mjs` (93.869 bytes) com esbuild, `platform: node`, ESM e alvo Node 18.                                       | O artefato de produção não é binário.                                                                                          |
| Claude            | `~/.local/bin/claude` resolve para `~/.local/share/claude/versions/2.1.259`, um ELF Linux; `--version` retornou `2.1.259`.                                 | Claude não é o bloqueio observado para remover o Node global.                                                                  |
| Scripts dinâmicos | `server/workspace/service.ts` chama `<raiz>/node_modules/.bin/tsx` para os comandos em `scripts/commands/`; esse arquivo começa com `#!/usr/bin/env node`. | Sem `node` no `PATH`, os quatro fluxos falham antes de executar o script.                                                      |
| Assets/caminhos   | O backend é um bundle único, mas `workspace/service.ts` resolve `MEGA_ROOT` a partir de `import.meta.url` e busca `node_modules/.bin/tsx` fora do bundle.  | Um executável precisa de um layout de runtime explícito; não pode pressupor o checkout nem embutir assets dinâmicos sem teste. |

Os comandos usados para repetir a inspeção são:

```bash
npm run server:build
node --version
node --help | rg -i 'sea|single|snapshot'
file "$(readlink -f "$(command -v claude)")"
claude --version
sed -n '240,305p' server/workspace/service.ts
head -n 1 node_modules/.bin/tsx
```

## Protocolo para uma futura prova de adoção

Uma proposta futura deve fornecer um executável Linux versionado e com checksum
no runtime WSL, sem alterar `node`, `npm`, `node_modules`, `.env.local`,
`~/.claude` ou credenciais do usuário. Rode numa distribuição limpa, em um
diretório temporário, com o candidato em `RUNTIME`:

```bash
RUNTIME=/caminho/para/mega-brain-backend
test -x "$RUNTIME"
env -i HOME="$HOME" PATH="$HOME/.local/bin:/usr/bin:/bin" \
  MEGA_BRAIN_SESSION_TOKEN=0123456789abcdef0123456789abcdef \
  MEGA_BRAIN_SESSION_ID=runtime-spike-session \
  WORKSPACE_DIR=/caminho/para/fixture-workspace \
  "$RUNTIME" >ready.jsonl 2>runtime.stderr &
pid=$!
# Validar uma única ready line JSON, /health e /version autenticados; encerrar $pid.
```

Depois, repita com `PATH` deliberadamente sem Node (`PATH="$HOME/.local/bin:/usr/bin:/bin"`
em uma imagem onde `/usr/bin/node` não exista) e aprove somente se todos os
critérios abaixo passarem:

1. ready line, `/health`, `/version`, autenticação, SSE e encerramento sem órfãos;
2. chat real com Claude e leitura de `~/.claude`, sem copiar credenciais;
3. os quatro scripts dinâmicos acima, inclusive seus imports e dependências;
4. operações de workspace, Git, assets e caminhos fora do diretório do runtime;
5. execução na distribuição WSL escolhida, com `TMPDIR=/tmp`, e rollback para o
   bundle/Node anterior após qualquer falha.

O teste deve falhar fechado se o candidato tentar resolver um asset relativo ao
checkout, se recorrer ao `node` global, ou se exigir copiar `node_modules` ou
segredos para a instalação. Só após essa matriz passar se pode substituir a
linha de comando do supervisor; isso fica fora deste spike.

## Limitações desta execução

Não havia ferramenta SEA/candidato de runtime disponível no ambiente, portanto
nenhum binário novo foi baixado ou criado. O sandbox também recusa bind em
`127.0.0.1` (`EPERM`), logo a validação ao vivo de `/health` não pode ocorrer
aqui. `npm run server:build` passou; a tentativa de `npm run server:test --
--run ...` expandiu a suíte `server/` e falhou somente nos testes que abrem
listeners loopback, além de apontar `jsdom` ausente para testes de frontend.
Essas falhas são ambientais e não evidência de regressão do bundle.
