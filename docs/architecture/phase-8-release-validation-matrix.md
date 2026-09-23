# Matriz de validação de release — Fase 8

Data: 2026-09-03  
Escopo: validações de hardening e integração do shell Tauri com o backend WSL.

Esta matriz não transforma provas locais em uma alegação de E2E Windows. Cada
linha separa o que é reproduzível sem serviços externos do aceite que requer
uma máquina Windows com WSL2.

| Cenário                                                               | Evidência automatizada local                                                                                                                                                                                                                     | Aceite em Windows/WSL real                                                                                                                         | Estado                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Domínio, configuração, parsing do handshake e lifecycle do supervisor | `npm test -- --run server src` e `cargo test --manifest-path src-tauri/Cargo.toml`                                                                                                                                                               | Não requerido além da regressão do instalador                                                                                                      | Coberto localmente                                                                   |
| Rotas HTTP, erros, Bearer, CORS e SSE                                 | `server/http-contract-matrix.test.ts`, `server/main.test.ts`, `server/main-sse.test.ts`, `server/transport-parity.test.ts`                                                                                                                       | Conferir contra bundle instalado                                                                                                                   | Coberto localmente; aceite pendente                                                  |
| Dois backends concorrentes                                            | `server/release-hardening.test.ts`: portas efêmeras distintas e token de uma sessão recusado na outra                                                                                                                                            | Abrir o app duas vezes e confirmar foco da primeira janela                                                                                         | Parcial: foco é OS/Tauri                                                             |
| Porta ocupada                                                         | `server/release-hardening.test.ts`: `EADDRINUSE`, listener não fica ativo                                                                                                                                                                        | Reservar porta no Windows e confirmar erro acionável do desktop                                                                                    | Parcial: apresentação do erro pendente                                               |
| Loopback, token e página local diferente                              | `server/main.test.ts` e `server/release-hardening.test.ts`: bind IPv4 `127.0.0.1`, 401 sem token ou token de outra sessão; `Origin` de `localhost:5173` e `127.0.0.1:5173` recebe 403 sem CORS                                                   | Tentar de outra origem/processo local no Windows                                                                                                   | Coberto no HTTP; enforcement do navegador/WebView pendente                           |
| Segredos em logs                                                      | `server/logger.test.ts` usa canários para token, Jira, prompt, conteúdo de arquivo e objetos de diagnóstico/crash com `Error.cause`                                                                                                              | Inspecionar logs/crash reports do instalador após falha induzida                                                                                   | Logs cobertos; crash reports dependem do Windows                                     |
| WSL parado, distribuição ausente, runtime ausente, handshake inválido | testes unitários de `src-tauri/src/supervisor.rs` e `src/desktopBootstrap.test.ts`                                                                                                                                                               | Executar cada falha real e validar mensagem/retry                                                                                                  | Parcial: spawn real exige Windows                                                    |
| Tauri inicia backend, health, falha/reinício e fecha sem órfão        | `supervisor.rs` usa fakes em memória para handshake, request/resposta de health, falha/retry e lifecycle; verifica que o launcher usa `exec node`, sem shell intermediário; `tauri-wsl-supervisor-health-spike.md` contém prova Windows anterior | Executar app empacotado, matar backend, fechar durante startup e verificar ausência de `node` filho                                                | Parcial: regressões de contrato cobertas; reexecutar no Windows por release          |
| E2E desktop (cards, diff, chat falso, configurações)                  | `src/phase8.fixture-contract.test.ts` percorre listar/criar/mover/excluir, detalhe/diff, chat SSE simulado e configurações pela `ApiClient` contra backend loopback isolado; sem WebDriver desktop neste repositório                             | Rodar roteiro manual com fixture, sem Jira/Claude                                                                                                  | Parcial: contrato simulado coberto; E2E desktop Windows pendente                     |
| Jira, Claude, Git/PR, Cursor, terminal, Café e ambientes dev          | Guard `test/safety-guard.ts` bloqueia Claude/Jira reais em testes                                                                                                                                                                                | Roteiro manual credenciado e descartável                                                                                                           | Pendente e deliberadamente não automatizado                                          |
| Upgrade interrompido e rollback                                       | `supervisor.rs` verifica sem WSL que instalação escreve só em staging/candidato, instala armadilha de limpeza e não altera `active`; ativação atômica só existe após health                                                                      | Interromper cópia, checksum, health e swap em cada etapa; confirmar symlink `active` anterior, workspaces, configurações e credenciais preservados | Parcial: contrato determinístico coberto; sem prova de `wsl.exe`/filesystem WSL real |
| Cold start do backend, e board utilizável                             | `npm run server:build && npm run server:benchmark-readiness` mede spawn→ready e spawn→`/health` do bundle, com percentis reproduzíveis                                                                                                           | Medir em Windows limpo com WSL2 e registrar cold start Tauri/WebView e tempo até board                                                             | Backend coberto quando sockets forem permitidos; produto Windows pendente            |
| Build de release/instalador                                           | `npm test`, `npm run build` e Cargo tests podem rodar localmente                                                                                                                                                                                 | `tauri build` e instalação limpa em Windows/CI Windows                                                                                             | Pendente: toolchain/assinatura Windows                                               |

## Harness reutilizável

`server/release-fixture.ts` monta um backend somente de loopback, com runtime
falso e token explícito. Ele é próprio para testes de falha de porta,
isolamento entre sessões e negação de capacidade, sem iniciar Vite, WSL,
workspaces, Jira, Claude ou processos externos.

`src/phase8.fixture-contract.test.ts` injeta nesse fixture um runtime em
memória, então atravessa a `ApiClient` e o servidor HTTP real, inclusive SSE,
mas não renderiza React nem abre WebView/Tauri. Isso é cobertura de contrato de
transporte com dados seguros: não equivale a E2E do desktop Windows, que ainda
precisa validar WebView, IPC, supervisor WSL, empacotamento e interação humana.

## Roteiro mínimo de aceite Windows/WSL

1. Em Windows 11 com WSL2 e uma distribuição previamente selecionada, instalar
   o artefato e abrir pelo menu Iniciar.
2. Confirmar `/health` pelo fluxo interno, board utilizável e que o servidor
   Vite da porta 5173 não foi tocado.
3. Abrir novamente: a janela existente deve receber foco. Fechar durante
   startup e após `ready`; confirmar que não resta `node` do Mega Brain.
4. Repetir com WSL desligado, Node removido e handshake/bundle incompatível;
   preservar somente os códigos acionáveis, sem stderr sensível na UI.
5. Rodar o fluxo desktop com fixture: criar/mover/excluir card, detalhe/diff,
   chat simulado e configurações. Fazer os fluxos Jira/Claude/Git apenas em
   contas e repositórios descartáveis.
6. Quando o runtime versionado existir, interromper upgrade em cada etapa e
   verificar checksum, runtime anterior ativo e preservação de workspaces,
   configurações e credenciais.
