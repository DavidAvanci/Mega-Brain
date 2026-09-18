# PLAN — Mega Brain Desktop com Tauri e backend Node

## Objetivo

Entregar uma versão instalável do Mega Brain para Windows que:

- abra por atalho, sem exigir `npm run dev` ou terminal;
- preserve o frontend React/Vite e o comportamento atual;
- continue operando sobre workspaces, Git, Claude e scripts existentes no WSL;
- mantenha o ambiente web local atual utilizável durante toda a implementação;
- separe definitivamente a interface do backend Node;
- produza um instalador Windows reproduzível e atualizável.

## Decisões de arquitetura

### Topologia inicial

```text
Mega Brain (Tauri/Windows)
  ├─ WebView2 com o frontend React compilado
  ├─ supervisor Rust
  │    ├─ localiza e valida o WSL
  │    ├─ inicia/monitora/encerra o backend
  │    └─ entrega endpoint e token à interface
  └─ backend Node executado no WSL
       ├─ API HTTP somente em 127.0.0.1
       ├─ workspace e arquivos Linux
       ├─ Git, Claude e scripts de automação
       ├─ Jira e medição de uso
       └─ integração com processos do Windows quando necessária
```

### Por que o backend roda no WSL

O estado atual depende de caminhos Linux, processos Linux, sessões do Claude em `~/.claude` e ferramentas instaladas no WSL. Empacotar o backend como um sidecar Windows comum alteraria essas premissas e exigiria migrar workspaces, credenciais e comandos. A primeira versão deve preservar o ambiente existente: o Tauri é nativo no Windows, mas supervisiona um processo Node no WSL.

### Compatibilidade durante a migração

- `npm run dev` continua usando a porta 5173 e funcionando como hoje.
- Os plugins Vite atuais permanecem disponíveis até seus substitutos terem testes de paridade.
- O frontend usa uma camada única de transporte: URLs relativas no modo web e endpoint/token no modo desktop.
- O desenvolvimento Tauri usa portas diferentes ou uma cópia de trabalho separada; nunca toma a porta 5173 da instância em uso.
- Nenhuma fase exige remover o caminho antigo antes de o novo estar validado.

### Limites da primeira versão

- Windows 11 + WSL2, para um único usuário local.
- Uma instância do Mega Brain por vez.
- Backend acessível somente por loopback e autenticado por token efêmero.
- Sem hospedagem pública, sincronização em nuvem ou suporte inicial a macOS/Linux nativo.
- Atualização automática fica para depois do primeiro instalador estável.

---

## Fase 0 — Baseline e prova da topologia

- [x] Registrar o comportamento atual com `npm test` e `npm run build`; guardar resultados como baseline. (Registro: `docs/baselines/2026-09-01-pre-tauri.md`.)
- [x] Inventariar todas as rotas e efeitos colaterais de `workspacePlugin.ts`, `chatPlugin.ts`, `jiraPlugin.ts`, `claudeUsagePlugin.ts` e `coffeePlugin.ts`. (Registro: `docs/architecture/vite-api-inventory.md`.)
- [x] Documentar os pré-requisitos reais do WSL: distribuição utilizada, Node mínimo, `claude`, Git, `gh`, `tsx`, shells e acesso a executáveis Windows. (Registro: `docs/architecture/wsl-prerequisites.md`.)
- [x] Confirmar que um processo Windows consegue iniciar um comando no WSL, receber stdout/stderr, detectar encerramento e finalizá-lo de modo limpo. (Registro: `docs/architecture/windows-wsl-supervision-spike.md`.)
- [x] Confirmar que uma WebView Tauri consegue chamar uma API em `127.0.0.1` usando porta dinâmica e token. (Registro: `docs/architecture/tauri-loopback-webview-spike.md`.)
- [x] Fazer um spike mínimo: janela Tauri → supervisor Rust → `/health` do Node no WSL. (Registro: `docs/architecture/tauri-wsl-supervisor-health-spike.md`; validado em Windows nativo com porta dinâmica autenticada e sem processo Node órfão.)
- [x] Medir tempo de inicialização e registrar mensagens esperadas para WSL ausente, Node ausente e backend com falha. (Registro: `docs/architecture/tauri-wsl-startup-diagnostics.md`; 10 amostras do backend, mediana utilizável de 88.1 ms; classificadores testados por injeção determinística.)

**Gate:** só avançar com a topologia WSL se inicialização, comunicação e encerramento funcionarem sem interferir no servidor Vite atual. Caso contrário, decidir explicitamente entre instalar um runtime Node Linux autocontido no WSL ou migrar o runtime inteiro para Windows.

## Fase 1 — Extrair o domínio dos plugins Vite

- [x] Criar `server/` com módulos independentes de Vite e sem dependência de React. (Base: contratos HTTP neutros, registro de rotas e guardrail estrutural em `server/`; sem alterar o Vite atual.)
- [x] Separar cada área em serviço e adaptador HTTP:
  - `workspace`: cards, configurações, arquivos, diffs, PRs, terminal e ambientes dev;
  - `chat`: histórico, envio por streaming e cancelamento;
  - `jira`: busca, status e transições;
  - `claude-usage`: credenciais, cache e consumo;
  - `coffee`: início, parada e estado da sessão.
- [x] Centralizar configuração tipada: workspace, credenciais Jira, diretórios, executáveis e modo de execução. (Fonte reutilizável: `server/config.ts`; adaptadores Vite e serviços consumidores migrados.)
- [x] Centralizar validação de pasta/card para impedir traversal e acesso fora do workspace configurado. (Guard compartilhado em `server/workspace/path.ts`, adotado pelos serviços workspace e chat; cobertura de traversal, separadores, inexistente e symlink escape em fixtures temporárias.)
- [x] Isolar chamadas de processo em uma interface testável (`ProcessRunner`) em vez de espalhar `spawn`/`execFileSync` pelas rotas. (Implementação Node em `server/process.ts`; chat, workspace, café, Git/PR e ambientes dev recebem/invocam a interface. Testes usam runner falso.)
- [x] Isolar sistema de arquivos e relógio onde isso melhora testes, sem reescrever a lógica estável desnecessariamente. (Escopo e decisão: `docs/architecture/fs-clock-isolation.md`; relógio injetável nos caches Jira/Claude e leitor de credenciais injetável no uso Claude, com testes determinísticos.)
- [x] Preservar os contratos JSON e SSE atuais para evitar mudanças grandes no frontend. (Evidência: `server/api-compatibility.test.ts` fixa status, headers e formatos JSON consumidos em `src/cards.ts`, `UsageMeter.tsx` e `CoffeeButton.tsx`, além do framing SSE `data: <JSON>\\n\\n` de `sendChat`; `npm test -- --run server/api-compatibility.test.ts` e `npm run build` passaram em 2026-09-01.)
- [x] Criar testes de contrato para sucesso, erro, payload inválido e cancelamento de cada rota. (Matriz: `docs/architecture/http-contract-test-matrix.md`; 22 rotas JSON e SSE com serviços falsos, sem efeitos externos.)
- [x] Garantir que os testes nunca executem Claude, apaguem workspaces reais ou alterem Jira. (Guardrails executáveis em `test/safety-guard.ts`: bloqueiam Claude/shells, Jira real e workspaces fora de `tmpdir()`; Git permanece permitido apenas em fixtures temporárias. Cobertura e limites: `docs/architecture/test-safety-guardrails.md`; validado pela suíte e testes dos próprios guardrails.)

**Gate:** a lógica de negócio pode ser chamada por testes sem criar um servidor Vite.

## Fase 2 — Criar o backend Node independente

- [x] Criar um entrypoint `server/main.ts` usando `node:http` ou uma camada HTTP mínima. (Adaptador independente com runtime injetável e lifecycle `start`/`stop`; teste usa runtime falso e porta temporária, sem Vite ou serviços reais.)
- [x] Escutar apenas em `127.0.0.1` e aceitar porta `0` para o sistema escolher uma porta livre. (O backend normaliza o host ausente para loopback e rejeita hosts públicos no config/override; `address()` expõe a porta efetivamente alocada após `start`. Testes usam runtime falso e diretórios temporários seguros, verificam bind IPv4, porta não-zero e encerramento.)
- [x] Gerar um token aleatório por execução e exigir `Authorization: Bearer ...` em todas as rotas, exceto o handshake definido com o supervisor. (Implementado em `server/auth.ts` e aplicado pelo listener standalone em `server/main.ts`; token de 32 bytes, comparação segura, injeção por `MEGA_BRAIN_SESSION_TOKEN` e sem rota pública antes da ready line. Contrato do supervisor e cobertura de rotação/vazamento: `docs/architecture/standalone-api-session-auth.md`, `server/auth.test.ts` e `server/main.test.ts`.)
- [x] Escrever em stdout uma única mensagem de prontidão estruturada contendo versão, porta e identificador da sessão; enviar logs normais para stderr. (Implementado em `server/main.ts`: JSONL versionado `{type, version, port, sessionId}`, streams/logger injetáveis e falha pré-prontidão apenas no stderr com exit não-zero. Cobertura em `server/main.test.ts` valida linha única, campos, stderr, falha e ausência de token; teste direcionado e build passaram em 2026-09-01.)
- [x] Implementar `/health` e `/version` para o supervisor distinguir inicialização, incompatibilidade e travamento. (Endpoints autenticados e versionados entram antes do runtime de rotas: `/health` sinaliza `ready`/`starting`/`degraded` com 200/503; timeout de resposta permite ao supervisor classificar travamento; `/version` expõe versões de protocolo e runtime Node para comparação. Contratos, auth, métodos e estados falsos cobertos em `server/main.test.ts`; uso documentado em `server/README.md`.)
- [x] Implementar CORS com allowlist exata para a origem do Tauri; não aceitar `*`. (Política fechada em `server/cors.ts`: somente `http://tauri.localhost` e `https://tauri.localhost`, baseada no spike Windows/Tauri 2; preflight `OPTIONS` limitado a `GET`, `POST`, `DELETE` e `Authorization`/`Content-Type`, com `Vary: Origin`. Origens ausentes não recebem CORS e continuam autenticadas; origens inválidas são rejeitadas sem cabeçalhos CORS. Cobertura de origem permitida, ausente, proibida/spoof prefixo/sufixo, preflight válido/inválido e ausência de wildcard em `server/main.test.ts`.)
- [x] Preservar streaming SSE e cancelamento do chat. (O adaptador standalone transmite cada frame `data: <JSON>\n\n` sem buffer completo, preserva `Content-Type`/cache/conexão, fecha no `done` e cancela o processo do chat em abort explícito ou desconexão. Cobertura determinística com `ProcessRunner` falso em `server/main-sse.test.ts` valida chunks antes do término, erro final, abort e cliente desconectado; testes direcionados e TypeScript passaram em 2026-09-02.)
- [x] Registrar e encerrar processos-filhos ao receber `SIGTERM`/`SIGINT`. (Registro explícito em `server/process.ts`: chat, agentes de etapa, Café e todos os comandos do ambiente dev recebem ownership opt-in; Cursor, terminal e navegador permanecem externos. `server/main.ts` fecha o listener, termina somente filhos registrados com TERM/KILL após timeout e remove handlers de sinal. `server/process-lifecycle.test.ts` cobre sinais falsos, idempotência, ausência de toque em processo externo e remoção dos handlers; `npx tsc --noEmit` passou.)
- [x] Impor limites de tamanho aos bodies e timeouts adequados a operações longas. (Política central em `server/main.ts`: JSON até 1 MiB, headers até 16 KiB, header/body idle de 15 s e prazo de 30 s apenas para rotas curtas; chat SSE e etapas ficam sem prazo global. Excesso retorna 413, timeout curto 408 e os timers são limpos. Documento e cobertura de limite, framing enganoso, timeout e SSE: `docs/architecture/standalone-http-limits.md`, `server/http-limits.test.ts`; validado com Vitest e `tsc` em 2026-09-02.)
- [x] Adicionar logs estruturados sem tokens, credenciais Jira, prompts completos ou conteúdo sensível de arquivos. (JSONL versionado em stderr com correlação de sessão/requisição, redaction defensiva e serialização segura de `Error`; política em `server/README.md` e canários em `server/logger.test.ts`.)
- [x] Criar scripts separados:
  - `npm run server:dev` para desenvolvimento;
  - `npm run server:build` para gerar o bundle de produção;
  - `npm run server:test` ou inclusão na suíte Vitest existente. (Os três comandos independentes estão documentados em `server/README.md`; o build produz `dist/server/main.mjs` para Node 20/WSL, dev usa `tsx watch` com token efêmero e encaminhamento de sinais, e a suíte é restrita a `server/`.)
- [x] Validar que o bundle roda no WSL sem depender do Vite. (Bundle Node 18 standalone recomposto com workspace/chat/Jira/Claude usage/Café; prova em diretórios temporários verificou ready, auth, health/version, rotas representativas, SSE/cancelamento falso e SIGTERM sem órfãos. Registro: `docs/architecture/standalone-bundle-wsl-validation.md`, 2026-09-02.)

**Gate:** todas as operações do app funcionam pela API Node independente, incluindo o streaming do chat e o encerramento de processos.

## Fase 3 — Manter o modo web compatível

- [x] Converter os plugins Vite em adaptadores finos que reutilizam os serviços/handlers de `server/`. (Os cinco plugins agora somente compõem serviços/handlers e usam `viteApiAdapter.ts` para o transporte Connect/HTTP/SSE; `vitePlugins.structural.test.ts` impede que lógica HTTP volte aos plugins. Testes focados e `npx tsc --noEmit` passaram em 2026-09-02.)
- [x] Evitar duas implementações das mesmas regras; Vite e backend independente devem chamar o mesmo código. (A composição única em `server/production-routes.ts` fornece as mesmas instâncias de handlers ao runtime standalone e ao adaptador Vite em `viteMegaBrainPlugin.ts`; `server/transport-parity.test.ts` e `vitePlugins.structural.test.ts` validam paridade/ausência de lógica duplicada. Testes focados, `npx tsc --noEmit` e `npm run build` passaram em 2026-09-02.)
- [x] Criar `src/apiClient.ts` como único ponto para `fetch`, base URL, autenticação, JSON, erros e SSE. (Cliente tipado com modos web/desktop, token apenas em memória, prefixo/query preservados, parsing seguro de JSON/erros e SSE incremental/cancelável; cobertura com fetch/streams falsos em `src/apiClient.test.ts`.)
- [x] Substituir os `fetch('/api/...')` diretos do frontend pelo cliente centralizado. (Cards, chat/SSE, Café e uso Claude usam exclusivamente `apiClient`; `src/frontendApiBoundary.test.ts` impede chamadas diretas fora dele. Testes focados, `tsc` e build passaram em 2026-09-02.)
- [x] No modo web, manter base URL vazia e ausência de token, preservando o comportamento atual. (O entrypoint web chama `bootstrapWebApiClient()` de modo síncrono antes do primeiro render/request; ele substitui explicitamente qualquer configuração desktop anterior por `{ mode: 'web', baseUrl: '' }`. Cobertura com fetch falso fixa URLs relativas `/api/...`, ausência de `Authorization` e reset após rebootstrap/HMR simulado; o adaptador Vite continua coberto na porta 5173 sem iniciar serviços reais.)
- [x] No modo desktop, obter endpoint/token do supervisor Tauri e mantê-los apenas em memória. (A fronteira `src/desktopBootstrap.ts` detecta Tauri 2 pelo marker interno + bridge, chama somente `backend_config`, valida loopback/porta/token e só então configura `apiClient`; token não é serializado. Testes cobrem sucesso, payload inválido, falha do invoke, bridge ausente, ausência de storage e nenhum request antes do bootstrap.)
- [x] Tratar “backend iniciando”, “backend indisponível” e “sessão expirada” na interface sem perder o estado visual do board. (State machine externa iniciada uma vez pelo entrypoint, boundary acessível com retry/rehandshake e banner sem desmontar o board após a primeira conexão; erros de transporte classificam indisponibilidade e 401 desktop expira a sessão. Cobertura de starting, sucesso, retry, rehandshake, retenção do board e deduplicação em `src/desktopConnection.test.ts`; `TMPDIR=/tmp npx vitest run src/desktopConnection.test.ts src/desktopBootstrap.test.ts src/apiClient.test.ts`, `npx tsc --noEmit` e `npm run build` passaram em 2026-09-02.)
- [x] Rodar a mesma suíte de contrato contra o adaptador Vite e contra o servidor Node. (Matriz HTTP compartilhada em `server/transport-parity.test.ts`: 7 testes passam nos dois transports reais em listeners loopback de porta `0`, com serviços falsos e sem iniciar Vite/5173. Paridade de domínio e diferenças legítimas de auth/CORS/parser documentadas em `docs/architecture/vite-standalone-contract-parity.md`; `npx tsc --noEmit` e `npm run build` passaram em 2026-09-02.)
- [x] Fazer smoke test manual do fluxo atual na porta 5173 antes e depois da mudança. (Evidência: `docs/baselines/2026-09-02-vite-5173-manual-smoke.md`; instância temporária somente-leitura, comparada ao baseline e contratos pré-existentes.)

**Gate:** o ambiente local atual continua funcional e não há diferenças conhecidas entre os contratos web e desktop.

## Fase 4 — Criar o shell Tauri

- [x] Inicializar Tauri 2 em `src-tauri/`, apontando `frontendDist` para o `dist` atual. (Shell mínimo em `src-tauri/`; `frontendDist` é `../dist`, o build chama `npm run build`, `tauri:dev` prepara o backend e inicia ou reutiliza o Vite em `127.0.0.1:15173`, e o alvo de bundle Windows inicial é NSIS.)
- [x] Configurar uma janela única, título, dimensões mínimas, ícones, tema e persistência de tamanho/posição. (Registro: `src-tauri/tauri.conf.json` e `src-tauri/src/lib.rs`; estado é restaurado com proteção contra coordenadas fora da tela e `cargo test --manifest-path src-tauri/Cargo.toml` passou.)
- [x] Aplicar CSP restritiva e habilitar somente as capabilities necessárias. (CSP bloqueia origens, frames, forms, objetos, mídia e workers; só libera assets locais, imagens `data:`, CSS inline e conexão loopback HTTP/WS para o backend. Capability da janela `main` restringe IPC a `allow-backend-config`; `cargo check` passou em 2026-09-02.)
- [x] Não expor shell genérico, filesystem amplo ou execução arbitrária ao JavaScript da WebView. (A capability da WebView permite somente `allow-backend-config`; `src-tauri` não declara plugins shell/fs/opener/process e o guardrail `webview_has_no_shell_or_filesystem_plugin_surface` passou com `cargo test` em 2026-09-02.)
- [x] Implementar no Rust um supervisor com estados explícitos: `starting`, `ready`, `failed`, `stopping`, `stopped`. (Implementado em `src-tauri/src/supervisor.rs`, com transições validadas/idempotentes e testes de startup, falha e shutdown; `cargo test --manifest-path src-tauri/Cargo.toml` passou em 2026-09-02.)
- [x] Iniciar o backend uma vez, consumir o handshake de stdout e disponibilizar endpoint/token por comando Tauri dedicado. (Supervisor em `src-tauri/src/supervisor.rs` injeta capability/ID efêmeros no filho WSL, valida JSONL versionado e expõe somente `backend_config`; teste do parser e `cargo test` passaram em 2026-09-02.)
- [x] Encerrar o backend e seus descendentes ao sair do app; impedir processos órfãos. (O `BackendSupervisor` registra o filho WSL antes do handshake, o toma/reap apenas uma vez em `shutdown` e limpa a configuração; `RunEvent::ExitRequested`/`Exit` o chama ao encerrar o Tauri. `cargo test --manifest-path src-tauri/Cargo.toml` passou em 2026-09-02, incluindo shutdown idempotente durante startup.)
- [x] Implementar instância única: ao abrir novamente, focar a janela existente. (Plugin `tauri-plugin-single-instance` encaminha o segundo launch para a janela `main`, que é mostrada, desminimizada e recebe foco; `cargo test --manifest-path src-tauri/Cargo.toml` passou em 2026-09-02.)
- [x] Mostrar uma tela curta de inicialização enquanto WSL/backend ficam prontos. (A `DesktopConnectionBoundary` mantém o app atrás de uma tela de espera até o handshake `backend_config` do supervisor terminar; a máquina de estados deduplica o bootstrap e preserva o quadro após reconexões. `npx vitest run src/desktopConnection.test.ts src/desktopBootstrap.test.ts` (16 testes) e `npx tsc --noEmit` passaram em 2026-09-02.)
- [x] Exibir erros acionáveis: WSL não instalado, distribuição não encontrada, runtime ausente, workspace inválido ou backend incompatível. (O supervisor classifica falhas em códigos estáveis, sem expor stderr; o bootstrap e a tela de conexão mostram instruções específicas e tentativa de reconexão. `npx vitest run src/desktopBootstrap.test.ts src/desktopConnection.test.ts` passou com 18 testes em 2026-09-03.)
- [x] Manter DevTools disponíveis apenas no build de desenvolvimento. (O `Cargo.toml` não habilita a feature opt-in `tauri/devtools`, que é a única forma de compilar o Web Inspector em release; a configuração da janela também não sobrescreve o padrão do Tauri, mantendo-o disponível apenas em builds debug. O teste de regressão `leaves_devtools_to_tauri_debug_builds_only` impede habilitação acidental da feature ou da opção de janela.)
- [x] Adicionar scripts `npm run tauri:dev` e `npm run tauri:build` sem alterar `npm run dev`. (`tauri:dev` usa o orquestrador local documentado em `docs/desktop/local-development.md`, `tauri:build` permanece `tauri build` e `dev` permanece `vite`.)

**Gate:** fechar e reabrir o desktop repetidamente não deixa backend ou agentes órfãos e não afeta a instância web em uso.

## Fase 5 — Bootstrap do backend no WSL

- [x] Detectar distribuições WSL e persistir a escolhida em configuração do app; não assumir silenciosamente uma distribuição. (`wsl.exe -l -q` é lido em UTF-8/UTF-16LE; a UI permite escolher apenas uma distribuição detectada e a preferência fica em `wsl-distro.json` no diretório de configuração do Tauri. Sem seleção, o supervisor retorna `distribution-not-found`, sem fallback para `Ubuntu`; `cargo test --manifest-path src-tauri/Cargo.toml`, `npx tsc --noEmit` e `git diff --check` passaram em 2026-09-03.)
- [x] Definir um diretório versionado do Mega Brain dentro do WSL, fora do repositório de trabalho, por exemplo `~/.local/share/mega-brain/runtime/<versão>`.
- [x] Na primeira abertura ou mudança de versão, instalar/copiar o bundle do backend de forma atômica e validar checksum.
- [x] Começar usando o Node existente no WSL, com verificação clara da versão mínima. (O supervisor exige Node >= 18.19.0 antes do startup.)
- [x] Avaliar e prototipar um binário Linux autocontido para remover a dependência de Node instalado; adotá-lo somente se Claude, scripts dinâmicos e resolução de assets continuarem funcionando. (Spike documentado; não adotado porque estágios dinâmicos dependem de `tsx`/Node.)
- [x] Nunca copiar `.env.local`, tokens ou credenciais para o diretório de instalação do Windows.
- [x] Carregar configuração do ambiente WSL existente e permitir configurar `WORKSPACE_DIR` pela interface. (Preferência persistida, IPC restrito e validação de caminho POSIX.)
- [x] Preservar compatibilidade com `~/.claude`, PATH do usuário e comandos invocados hoje. (O launcher usa o ambiente de login da distro sem copiar segredos.)
- [x] Implementar upgrade transacional do runtime: instalar nova versão, validar `/health`, então trocar a versão ativa; manter a anterior para rollback.
- [ ] Remover somente runtimes antigos criados pelo próprio app, nunca diretórios de workspace ou configuração do usuário.

**Gate:** uma instalação limpa inicia o backend automaticamente após configuração inicial e uma atualização com falha volta à versão anterior.

## Fase 6 — Adequar integrações específicas da plataforma

- [x] Revisar abertura do Cursor, Windows Terminal, Chrome e URLs a partir de um backend executado no WSL. (Descoberta segura de executáveis e chamadas por comando+argv.)
- [x] Manter argumentos como arrays, sem construir comandos de shell com strings interpoladas.
- [x] Validar caminhos com espaços, caracteres Unicode e repositórios em `/home` e `/mnt/c`. (Cobertura determinística de plataforma; validação manual Windows continua pendente.)
- [x] Garantir que o botão Café continue chamando PowerShell e libere o estado de energia ao sair ou falhar. (Pré-validação e cleanup idempotente cobertos por teste.)
- [ ] Validar detecção de terminais Claude existentes e retomada de sessão.
- [ ] Validar criação/encerramento dos ambientes dev e abertura das URLs resultantes.
- [x] Definir comportamento quando executáveis opcionais (`cursor`, `wt.exe`, Chrome, `gh`) não estiverem disponíveis. (Erros acionáveis, sem shell interpolado.)

**Gate:** todas as ações do board possuem paridade com a versão web atual no computador real de destino.

## Fase 7 — Empacotamento Windows

- [x] Configurar bundle Tauri com nome, identificador, versão, ícones e metadados do Mega Brain.
- [ ] Gerar inicialmente instalador NSIS (`Mega Brain Setup.exe`); avaliar MSI somente se houver necessidade operacional.
- [ ] Executar o build final em Windows nativo ou CI Windows, não depender de cross-compilação a partir do WSL.
- [ ] Incluir WebView2 conforme a estratégia escolhida e testar instalação sem ambiente de desenvolvimento aberto.
- [x] Incluir os artefatos necessários ao bootstrap WSL e validar seus checksums no build. (Manifesto e verificador também rodam no CI Windows.)
- [x] Definir onde ficam logs, configuração e cache, e adicionar uma ação para abrir a pasta de diagnóstico.
- [x] Avaliar assinatura de código antes de distribuir para outras máquinas; documentar o aviso do SmartScreen enquanto o binário não estiver assinado.
- [ ] Produzir um artefato com versão imutável e checksum publicado junto ao release.
- [x] Adiar auto-update até o fluxo de assinatura e rollback estar validado.

**Gate:** o instalador funciona em uma máquina Windows limpa com WSL2, e desinstalar remove apenas arquivos do aplicativo, preservando workspaces e configurações/documentando o que permanece.

## Fase 8 — Testes e hardening

- [x] Unitários: domínio, validação, configuração, supervisor e parsing do handshake.
- [x] Contrato: todas as rotas, erros HTTP, autenticação, CORS e SSE.
- [ ] Integração: Tauri inicia backend, recebe health, reinicia após falha e encerra no fechamento.
- [ ] E2E web: principais fluxos pela porta 5173.
- [ ] E2E desktop: listar/criar/mover/excluir card de fixture, abrir detalhe/diff, chat simulado e configurações.
- [ ] Testar manualmente Jira real, Claude real, Git/PRs, Cursor, terminal, Café e ambientes dev.
- [ ] Testar duas aberturas simultâneas, porta ocupada, WSL parado, backend travado, token inválido e upgrade interrompido.
- [ ] Confirmar que a API não aceita conexões externas e que outra página local sem token não consegue executar ações.
- [ ] Confirmar que logs e crash reports não contêm segredos.
- [ ] Medir uso de memória, tempo de cold start e tempo até o board utilizável.
- [ ] Executar `npm test`, `npm run build`, testes Rust e build do instalador em CI.

## Fase 9 — Cutover gradual

- [ ] Usar a versão desktop em paralelo com o ambiente web por um período de validação.
- [ ] Registrar diferenças de comportamento e corrigir no código compartilhado.
- [ ] Considerar o desktop principal somente após todos os fluxos críticos terem paridade.
- [ ] Manter `npm run dev` como modo de desenvolvimento e recuperação; não removê-lo no primeiro release.
- [ ] Documentar instalação, primeira configuração, atualização, logs, recuperação e desinstalação.
- [ ] Criar tag/release apenas quando o checklist de aceite estiver completo.

---

## Critérios de aceite do primeiro release

- [ ] O usuário instala e abre o Mega Brain pelo menu Iniciar sem abrir terminal.
- [ ] O app inicia automaticamente seu backend no WSL e mostra o board existente.
- [ ] Nenhuma instalação global de dependências é necessária além dos pré-requisitos explicitamente documentados.
- [ ] Cards, etapas, agentes, chat, Jira, diffs, PRs, ambientes dev, uso Claude e Café têm paridade com o app atual.
- [ ] Fechar o app encerra somente os processos pertencentes ao Mega Brain e não mata sessões externas.
- [ ] O servidor existente em `localhost:5173` pode continuar rodando durante desenvolvimento e validação.
- [ ] Reabrir, atualizar ou reinstalar não apaga workspaces, configurações ou credenciais.
- [ ] O instalador é reproduzível, versionado e passou pelo teste em Windows limpo com WSL2.

## Ordem recomendada de commits

1. `test: capture current API contracts`
2. `refactor: extract workspace services from Vite`
3. `refactor: extract chat and integration services`
4. `feat: add standalone Node backend`
5. `refactor: centralize frontend API transport`
6. `test: verify parity between Vite and standalone server`
7. `feat: add Tauri shell and backend supervisor`
8. `feat: bootstrap versioned backend runtime in WSL`
9. `fix: preserve platform integrations in desktop mode`
10. `build: produce signed-ready Windows installer`
11. `docs: add desktop installation and recovery guide`

Cada commit deve deixar `npm run dev`, `npm test` e `npm run build` funcionais. A remoção de qualquer implementação antiga só acontece em commit posterior à comprovação de paridade.

## Principais riscos e mitigação

| Risco | Mitigação |
|---|---|
| Tauri Windows e backend WSL terem ciclos de vida diferentes | Supervisor Rust, handshake versionado, health check e encerramento explícito |
| API loopback ser chamada por outro processo/página local | Bind em `127.0.0.1`, porta aleatória, token efêmero, CORS estrito e CSP |
| Empacotador Node não suportar imports/assets/processos dinâmicos | Começar com bundle JS + Node do WSL; tornar runtime autocontido uma otimização validada |
| Alterações quebrarem o app atualmente em uso | Adaptadores compatíveis, portas distintas, testes de contrato e cutover gradual |
| Build Windows a partir do WSL ser frágil | Gerar instalador em Windows nativo ou CI Windows |
| Encerramento do desktop matar agentes que devem continuar | Catalogar ownership de cada processo e encerrar apenas filhos explicitamente gerenciados |
| Upgrade danificar o runtime WSL | Diretórios versionados, checksum, troca atômica e rollback |
| Credenciais vazarem no bundle ou logs | Configuração somente no WSL, redaction e inspeção do artefato final |

## Referências técnicas

- [Tauri 2 — Node.js como sidecar](https://v2.tauri.app/learn/sidecar-nodejs/)
- [Tauri 2 — binários externos](https://v2.tauri.app/develop/sidecar/)
- [Tauri 2 — instalador Windows](https://v2.tauri.app/distribute/windows-installer/)
