# Auditoria de performance — Mega Brain

Data: 08/10/2026. Base: `7b77c92b8c48ffad0ae37ab680d6391b3a36071c`, incluindo as alterações locais que já estavam presentes. Escopo: frontend React, backend Node, shell Tauri/Rust e bootstrap WSL. Nenhuma correção de código de produção foi aplicada.

## Resultado

Os primeiros alvos são **a retenção ilimitada de stderr no supervisor**, **as varreduras repetidas de sessões no primeiro carregamento** e **a descoberta síncrona de editores em toda abertura**. Para uso prolongado, também há caches sem descarte e requisições que continuam trabalhando após timeout.

Há 13 achados abaixo. “Confirmado no código” significa que o mecanismo está presente; não significa que o impacto em RAM ou tempo foi medido em uma sessão real. As prioridades são propostas de execução: P1 primeiro, P2 em seguida. Não há evidência suficiente para afirmar um vazamento dominante no heap React ou prometer um ganho percentual de startup.

| ID  | Prioridade | Achado                                                           | Principal efeito                                            |
| --- | ---------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| 01  | P1         | stderr do backend acumulado até EOF                              | Crescimento contínuo de memória no desktop                  |
| 02  | P1         | Histórico de agentes varrido separadamente pelo quadro e sidebar | Primeiro quadro e CPU/I/O recorrentes                       |
| 03  | P1         | Descoberta recursiva de editores em toda inicialização           | Bloqueio do event loop na abertura                          |
| 04  | P2         | Várias chamadas WSL sequenciais e ambiente lido repetidamente    | Latência antes de disponibilizar o backend                  |
| 05  | P2         | Base64 do bundle reconstruído mesmo com runtime instalado        | Alocação e CPU transitórias no startup                      |
| 06  | P1         | Polling do quadro/detalhe sem exclusão mútua e sem abort         | Sobreposição, respostas descartadas e atraso de atualização |
| 07  | P1         | Timeout HTTP não cancela operações; Jira sem deadline própria    | Trabalho e memória retidos após a resposta                  |
| 08  | P2         | Smart Diff guarda documentos completos sem eviction              | Memória acumulada por card revisado                         |
| 09  | P2         | Caches de PR/Jira e mapas da UI sem descarte adequado            | Retenção crescente em sessões longas                        |
| 10  | P2         | Todos os cards montados e objetos recriados em cada polling      | Custo inicial de DOM e renderizações recorrentes            |
| 11  | P1         | Git síncrono no backend, inclusive housekeeping da listagem      | Bloqueio de todas as requisições e do health                |
| 12  | P2         | Logs JSONL lidos integralmente para calcular custo               | Picos de memória e pausas no backend                        |
| 13  | P2         | Escrita SSE ignora backpressure                                  | Buffer crescente com consumidor lento                       |

## Medições e limites

### Build atual do frontend

Executado `node node_modules/vite/bin/vite.js build --outDir <diretório temporário> --manifest`, com Vite 6.4.3. Saída fora de `dist`; build concluído em 22,52 s. Esse é tempo de compilação, **não startup do app**. A primeira tentativa falhou por restrição de `realpath` do sandbox; a execução autorizada seguinte concluiu.

| Artefato      | Tamanho minificado | Gzip calculado pelo Vite |
| ------------- | -----------------: | -----------------------: |
| JS principal  |          634,88 kB |                208,86 kB |
| CSS principal |          108,55 kB |                 21,47 kB |
| CardModal     |           60,22 kB |                 21,59 kB |
| DiffTab       |        1.150,18 kB |                352,26 kB |

Gzip é uma referência de compressibilidade; não representa necessariamente bytes transferidos pelo protocolo local do Tauri. CardModal e DiffTab já usam importação dinâmica e não devem ser somados ao JS inicial de uma abertura normal do quadro.

Uma oportunidade complementar é separar o botão `NewCard` do formulário `NewCardDialog`, atualmente no mesmo módulo importado estaticamente por App e Column, e carregar o formulário ao abrir. Isso permite tirar triagem e textarea de menções do grafo inicial quando não forem compartilhados com outros módulos. Evidências: [App.tsx](C:/Users/david/mega-brain/src/App.tsx:22), [NewCard.tsx](C:/Users/david/mega-brain/src/features/cards/ui/NewCard.tsx:1). O ganho precisa ser medido depois da separação; o tamanho do entrypoint, sozinho, não prova qual dependência domina nem justifica quebrar chunks arbitrariamente.

### Varredura de sessões com fixtures sintéticas

Executado `node --import tsx docs/performance/audit-2026-10-08.ts`. Windows, Node v24.16.0, arquivos JSONL pequenos em diretório temporário, sem processos ativos, sem rede, sem ler históricos pessoais. Uma chamada inicial e cinco chamadas seguintes por cenário; todos retornaram 40 sessões.

| Arquivos encontrados | Primeira chamada | Mediana das cinco chamadas seguintes |
| -------------------: | ---------------: | -----------------------------------: |
|                  100 |         93,44 ms |                             88,28 ms |
|                1.000 |         93,29 ms |                             91,02 ms |
|                5.000 |        122,03 ms |                            120,53 ms |

O custo permanece em cada chamada, embora o histórico retornado seja limitado a 40. “Primeira” significa primeira chamada da instância do serviço; os arquivos acabaram de ser escritos, portanto **não é um benchmark de disco frio**. A amostra não reproduz WSL, `/mnt/c`, arquivos grandes, descoberta de processos ou uso real. Não extrapolar os números diretamente para o desktop. Script reproduzível: [audit-2026-10-08.ts](C:/Users/david/mega-brain/docs/performance/audit-2026-10-08.ts).

Não foram executados o app desktop, captura de heap/RSS, teste de longa duração ou benchmark de WSL frio. O bundle backend existente não foi usado para medir readiness, pois pode não representar as alterações locais atuais. A revisão não requer alterar nem executar cards/agentes reais.

## Achados detalhados

### 01 — Retenção ilimitada de stderr no supervisor

**Confirmado no código; impacto acumulado não medido.** [supervisor.rs:354](C:/Users/david/mega-brain/src-tauri/src/supervisor.rs:354) cria uma thread que usa `read_to_string(&mut detail)` no stderr. Ela só entrega a string ao canal quando chega EOF. O backend saudável permanece vivo, portanto o histórico inteiro fica na memória da thread.

Não depende de erros: [adapter.ts:44](C:/Users/david/mega-brain/server/http/adapter.ts:44) registra requisições normais; quadro e sidebar fazem polling a cada cinco segundos. O consumo cresce com bytes de log produzidos durante a vida do processo. É retenção sem limite, liberada ao encerrar, não um recurso que o GC do frontend possa resolver.

**Correção:** drenar continuamente para um buffer circular com orçamento de bytes, por exemplo 64 KiB. Se houver necessidade de histórico completo, usar arquivo com rotação e preservar sanitização. Evitar ler uma linha inteira sem limite caso o produtor deixe de emitir quebras de linha.

**Validação:** backend sintético produzindo stderr por vários minutos; memória do processo Rust deve estabilizar, o pipe continuar drenado e a classificação de falhas continuar funcionando.

### 02 — Varredura repetida do histórico de agentes

**Confirmado no código e custo reproduzido sinteticamente.** [agents/service.ts:349](C:/Users/david/mega-brain/server/agents/service.ts:349) percorre projetos Claude, sessões Codex e sessões arquivadas, faz `stat`, ordena todos os arquivos e só então aplica o limite de 40. Para cada arquivo selecionado, lê head e tail de até 192 KiB cada. Uma sessão associada a processo ativo passa novamente por `sessionFromFile`, repetindo leitura e parsing.

[production-routes.ts:78](C:/Users/david/mega-brain/server/production-routes.ts:78) chama `agentService.list()` para compor o quadro. [AppSidebar.tsx:24](C:/Users/david/mega-brain/src/AppSidebar.tsx:24) também assina o store de agentes e dispara `/api/agents`. Ambos repetem a consulta a cada cinco segundos, sem cache compartilhado do resultado. Em WSL, a composição também inclui o histórico Windows em `/mnt/c/Users/.../.codex` quando configurado pelo caminho padrão.

**Correção:** snapshot compartilhado com validade curta, cache de parsing por caminho/mtime/tamanho com eviction e seleção das sessões mais recentes sem ordenar o histórico inteiro. Separar descoberta ativa do histórico arquivado, preservando a associação de agentes aos cards. Aplicar estado do processo a uma sessão já parseada, sem reler o arquivo.

**Validação:** número de scans por intervalo, bytes lidos, event-loop delay e tempo do primeiro quadro em históricos pequenos/grandes; garantir que sessões ativas e arquivadas permaneçam corretas.

### 03 — Descoberta de editores é incondicional e síncrona

**Confirmado no código.** [App.tsx:78](C:/Users/david/mega-brain/src/App.tsx:78) chama settings e `fetchDetectedEditors()` em paralelo antes de saber se o onboarding é necessário. Isso acontece também com onboarding já concluído. [editor-detection.ts:33](C:/Users/david/mega-brain/server/editor-detection.ts:33) usa `existsSync` e `readdirSync` em busca recursiva de até cinco níveis; IntelliJ, WebStorm e PyCharm podem repetir buscas nas mesmas árvores de instalação Windows.

Não bloqueia explicitamente o render React, mas bloqueia o event loop do backend quando a rota é atendida e pode atrasar requests do quadro, agentes e health.

**Correção:** consultar primeiro a necessidade do onboarding; descobrir editores apenas para onboarding/configurações. Cachear por sessão, fazer uma única travessia para todos os executáveis e usar I/O assíncrono ou worker para buscas extensas.

**Validação:** startup com onboarding concluído deve emitir zero requests de descoberta; medir duração da rota com Toolbox grande e editores ausentes.

### 04 — Bootstrap WSL faz etapas sequenciais redundantes

**Confirmado no fluxo de release; latência não medida.** [supervisor.rs:307](C:/Users/david/mega-brain/src-tauri/src/supervisor.rs:307) encadeia verificação de Node, consulta de HOME, instalação/verificação, início do backend, health e ativação. A ativação consulta HOME novamente. [supervisor.rs:563](C:/Users/david/mega-brain/src-tauri/src/supervisor.rs:563) executa um novo `wsl.exe --exec env` para cada valor consultado.

Com workspace salvo, o caminho de sucesso contém seis lançamentos de `wsl.exe`; sem workspace salvo, há mais duas consultas de ambiente. O frontend ainda verifica a disponibilidade em intervalos de 250 ms: [desktopConnection.ts:14](C:/Users/david/mega-brain/src/desktopConnection.ts:14). A espera de dez segundos no supervisor cobre o handshake, não todas as etapas anteriores.

**Correção:** obter HOME e WORKSPACE_DIR em uma consulta por tentativa, reutilizar HOME na ativação e reduzir fronteiras de processo onde possível. Considerar evento de readiness com consulta inicial para não perder eventos. Manter verificação de versão, autenticação, integridade e ativação transacional.

**Validação:** medir separadamente WSL frio/quente, probes, instalação, handshake, health, publicação da configuração e primeiro quadro. Quantificar antes de reorganizar a instalação.

### 05 — Instalação quente reconstrói Base64 desnecessariamente

**Confirmado no código.** O script shell verifica tamanho/hash e sai cedo se a versão já existe. Entretanto, [supervisor.rs:590](C:/Users/david/mega-brain/src-tauri/src/supervisor.rs:590) primeiro calcula `runtime_install_script(artifact)` para passá-lo a `write_all`: codifica o bundle inteiro em Base64, substitui o placeholder e cria a saída completa, mesmo se o filho já decidiu sair.

É um pico transitório de memória e CPU, não vazamento persistente. O backend atualmente presente em `dist/server/main.mjs` tem 361.614 bytes; esse tamanho é apenas referência do artefato local existente e pode mudar em outro build.

**Correção:** protocolo de verificação seguido de transferência apenas quando necessária; se precisar transferir, evitar múltiplas cópias integrais e preferir streaming. Avaliar o custo de um probe adicional antes de implementá-lo. A validação SHA-256 deve continuar obrigatória.

**Validação:** mesma versão instalada deve transferir zero bytes de artefato e evitar a codificação; medir startup e pico de RAM com bundle maior.

### 06 — Polling sobrepõe operações e pode descartar todas as respostas

**Confirmado no código; depende de lentidão.** [card-commands.ts:58](C:/Users/david/mega-brain/src/features/cards/model/card-commands.ts:58) inicia cada refresh sem um guard de request em andamento. O intervalo é cinco segundos e cada chamada incrementa `refreshVersion`. Se a listagem demorar mais que o intervalo continuamente, a próxima rodada invalida a anterior antes de ela concluir; o quadro pode continuar sem receber um snapshot aceito. Requests já iniciados continuam consumindo recursos.

[useCardDetail.ts:25](C:/Users/david/mega-brain/src/features/cards/model/useCardDetail.ts:25) repete o padrão nos detalhes. O cleanup limpa o timer e ignora respostas, mas não aborta o request. O polling do quadro continua quando outra página está selecionada porque `useCards()` pertence a App.

**Correção:** uma execução por recurso, agendamento após conclusão, timeout e AbortController no cleanup. Manter a proteção contra snapshots anteriores às movimentações otimistas, sem fazer cada tick invalidar uma leitura legítima. Reduzir polling de dados visuais em segundo plano; preservar notificações e automação que hoje dependem da listagem.

**Validação:** backend com atraso de oito segundos, navegação rápida entre cards e janela em segundo plano; requests simultâneos devem ficar limitados e o quadro deve atualizar. `agents-state` já deduplica chamadas em andamento e `UsageMeter` já usa guard/abort: bons modelos internos.

### 07 — Timeout responde, mas não interrompe o trabalho

**Confirmado no código; retenção depende de operações lentas.** [json-body.ts:62](C:/Users/david/mega-brain/server/http/json-body.ts:62) rejeita a promessa externa após timeout, sem cancelar a promessa original. [jira/service.ts:95](C:/Users/david/mega-brain/server/jira/service.ts:95) faz fetch sem AbortSignal/deadline própria; `statuses()` usa `Promise.all` por issue e não deduplica requests em andamento por chave.

Se Jira demora, requests posteriores podem disparar novas consultas enquanto as anteriores permanecem ativas, mesmo após HTTP 408. Isso pode reter closures, respostas e sockets. A proteção de timeout também não consegue preemptar código síncrono que bloqueia o event loop.

**Correção:** propagar cancelamento do request/timeout às integrações, incluir timeout próprio, deduplicação por chave e concorrência limitada no Jira. Considerar consulta em lote. Usar TTL para frescor e eviction para memória, como no achado 09.

**Validação:** fetch simulado que não conclui sem abort; depois do timeout/desconexão não deve restar operação ativa. Repetir por múltiplas issues e verificar teto de concorrência.

### 08 — Cache Smart Diff retém documentos completos

**Confirmado no código.** [smart-diff-review.ts:90](C:/Users/david/mega-brain/server/workspace/smart-diff-review.ts:90) mantém `states` durante toda a vida do serviço. Ao concluir, [linha 176](C:/Users/david/mega-brain/server/workspace/smart-diff-review.ts:176) guarda `result: document`, com patches e explicações, embora o mesmo resultado já esteja persistido em `diff.json`. Não há TTL, limite de bytes, eviction ou integração com exclusão do card.

O crescimento é proporcional aos documentos de cards distintos gerados pelo serviço nessa execução; reabrir resultados antigos do disco, sem gerar, não insere automaticamente no mapa.

**Correção:** manter estado de jobs ativos e metadados leves; ler resultados persistidos sob demanda ou usar LRU com orçamento de bytes. Limpar entradas ao excluir cards e ao trocar workspace.

**Validação:** gerar revisões grandes em vários cards; após fechar/excluir e executar GC, heap do Node deve estabilizar dentro do orçamento do cache.

### 09 — TTL sem eviction e mapas globais da UI

**Confirmado no código; tamanho real não medido.** [pr-status.ts:28](C:/Users/david/mega-brain/server/platform/pr-status.ts:28) nunca remove URLs: estados merged/closed ficam guardados indefinidamente, inclusive após remover o card. [jira/service.ts:93](C:/Users/david/mega-brain/server/jira/service.ts:93) expira valores para frescor, mas não remove issues que deixam de ser consultadas.

No frontend, [DiffTab.tsx:114](C:/Users/david/mega-brain/src/features/cards/ui/DiffTab.tsx:114) mantém `collapseState` por card com conjuntos de chaves vistas, sem limite de cards ou pruning das chaves de revisões antigas. [card-commands.ts:26](C:/Users/david/mega-brain/src/features/cards/model/card-commands.ts:26) mantém `userInitiatedStatusChanges`: `expiresAt` só é consultado em `consumeUserInitiatedStatusChange`, chamado para transições a estados de atenção. Movimentações para outros estados podem permanecer no mapa por toda a sessão.

**Correção:** eviction por quantidade/idade, pruning por cards/URLs ainda presentes, limpeza na exclusão/troca de workspace e expiração efetiva de ações da UI. Limitar `seen` à revisão atual. Preservar estados úteis dos últimos cards sem manter todo o histórico.

**Validação:** navegar/revisar/mover e remover centenas de cards distintos; inspecionar tamanho dos mapas e heap após GC. Essas entradas tendem a ser menores que documentos de Smart Diff, portanto não atribuir a elas o maior consumo sem profiling.

### 10 — Quadro sem virtualização e memoização anulada por novos objetos

**Confirmado no código; impacto depende do volume.** [Column.tsx:102](C:/Users/david/mega-brain/src/features/board/Column.tsx:102) monta todos os cards, inclusive os fora da área visível. A dependência de virtualização existe, mas não é usada nesse caminho. [card-commands.ts:65](C:/Users/david/mega-brain/src/features/cards/model/card-commands.ts:65) reconstrói os cards da resposta e, depois do Jira, cria novamente cada objeto, mesmo sem mudanças. `CardView` usa `memo`, mas o novo objeto `card` invalida a comparação superficial.

**Correção:** preservar identidade de cards inalterados e não emitir snapshot quando nada mudou. Virtualizar colunas grandes após validar drag-and-drop, alturas variáveis, minimapa e navegação por teclado. Paginação/limite de histórico também pode reduzir o conjunto de dados.

**Validação:** profiler React com 100/500/1.000 cards: primeiro commit, commits por polling sem alterações, quantidade de nós DOM e memória. Não tratar DOM proporcional ao número de cards como vazamento.

### 11 — Git e housekeeping bloqueiam o backend inteiro

**Confirmado no código.** [worktree-inspector.ts:38](C:/Users/david/mega-brain/server/workspace/worktree-inspector.ts:38) usa `execFileSync`, sem timeout, com `maxBuffer` de 64 MiB. Detalhes de repositórios invocam vários comandos sequenciais. Esse limite é capacidade máxima de buffer, não uma alocação imediata de 64 MiB por comando.

[board-list.ts:52](C:/Users/david/mega-brain/server/workspace/board-list.ts:52) também pode excluir cards expirados durante o GET do quadro. [worktree-lifecycle.ts:80](C:/Users/david/mega-brain/server/workspace/worktree-lifecycle.ts:80) remove/prune worktrees com Git síncrono e faz exclusão recursiva. Um primeiro GET com housekeeping pesado atrasa o primeiro quadro e as demais rotas, incluindo health.

**Correção:** comandos assíncronos com timeout, concorrência limitada e cache de metadados. Mover housekeeping para fila separada com exclusão mútua e progresso observável, preservando as regras existentes de expiração/etapas. Não usar um timeout externo como substituto para tornar o Git cancelável.

**Validação:** repositório grande/Git atrasado e card expirado com múltiplas worktrees; medir event-loop delay e latência de `/health` em paralelo.

### 12 — Leitura integral de logs para contabilização

**Confirmado no código.** [stage-agent.ts:142](C:/Users/david/mega-brain/server/workspace/stage-agent.ts:142) lê o JSONL completo no encerramento. [agent-usage.ts:107](C:/Users/david/mega-brain/server/workspace/agent-usage.ts:107) repete a leitura ao recuperar runs cujos processos terminaram. `claudeCostFromStream()` faz `split('\n')` e parse de todas as linhas para encontrar o custo final.

Arquivos grandes geram alocação da string integral, array de linhas e objetos parseados, além de I/O síncrono. É memória transitória com potencial de pausas/OOM, não retenção permanente comprovada.

**Correção:** calcular e persistir custo conforme chegam eventos; para recuperação, streaming incremental ou busca reversa em blocos até encontrar o último `result`. Um tail fixo sozinho pode perder o evento de custo e precisa de fallback correto.

**Validação:** logs de 10/100/500 MiB; comparar pico de RSS, tempo de recuperação e custo final calculado, incluindo linha final grande/incompleta.

### 13 — SSE ignora backpressure

**Confirmado no código; crescimento depende do consumidor.** [sse.ts:34](C:/Users/david/mega-brain/server/http/sse.ts:34) chama `response.write()` e ignora seu retorno. O produtor de eventos continua consumindo stdout de agentes em [chat/service.ts:215](C:/Users/david/mega-brain/server/chat/service.ts:215). Se a conexão ainda existe, mas o consumidor lê devagar, o Node pode acumular buffers de saída.

**Correção:** fluxo que respeite `drain`, pausando o produtor ou usando fila limitada com política explícita. Não descartar deltas de texto arbitrariamente. Limitar também buffers de framing em caso de eventos/linhas sem terminador, no produtor e no cliente SSE.

**Validação:** consumidor conectado com leitura lenta e muitos eventos; RAM/fila devem ficar limitadas, conteúdo permanecer íntegro e cancelamento ao desconectar continuar funcionando.

## Proteções existentes que devem ser preservadas

- Bootstrap desktop iniciado fora de effects React e deduplicado por promessa: evita duplicação pelo StrictMode.
- CardModal, DiffTab, settings, onboarding e páginas secundárias já têm carregamento sob demanda; React Scan é opt-in em desenvolvimento.
- Timers/listeners/observers dos principais hooks examinados têm cleanup. Stores de cards/agentes removem assinantes e param timers quando não há assinantes.
- `UsageMeter` tem guard de carregamento, abort no cleanup e deadline; consumo Claude deduplica chamadas e tem cache de uma entrada.
- Triagem tem limite de concorrência e cache limitado a 100 entradas; não foi classificada como cache ilimitado.
- Chat remove processos do mapa no fechamento; ownership/shutdown e cancelamento SSE já existem. Corrigir backpressure sem perder essas garantias.
- Leitura de histórico do chat e de sessões já limita head/tail; isso reduz picos, embora não elimine varreduras repetidas.

## Ordem sugerida e critérios de aceite

1. **Estabilizar memória:** stderr limitado (01), cancelamento real (07), eviction de documentos (08) e caches (09).
2. **Reduzir o primeiro quadro:** snapshot compartilhado de agentes (02), descoberta de editores sob demanda (03), housekeeping fora do GET (11).
3. **Reduzir startup do desktop:** instrumentar fases e eliminar consultas WSL redundantes (04); evitar Base64 na instalação quente (05); testar separação do formulário do bundle inicial.
4. **Reduzir trabalho contínuo:** polling sem sobreposição (06), identidade estável/virtualização (10), contabilização incremental (12) e backpressure (13).

Medir processos separadamente: shell Rust, backend Node/WSL e WebView. Para startup, registrar início do processo → handshake → API utilizável → primeira resposta de workspace → quadro interativo, com p50/p95 e WSL frio/quente separados. O benchmark existente `server:benchmark-readiness` mede backend standalone e health; não cobre WSL, carregamento de cards nem renderização.

Para memória, usar séries temporais e snapshots antes/depois de fechar modais, excluir cards e finalizar agentes; executar GC apenas nos testes em que ele esteja disponível. Aceite: buffers/caches com limites explícitos, ausência de operações órfãs após cancelamento, memória estabilizando sob carga repetida e melhorias medidas do tempo até quadro interativo sem alterar comportamento das etapas.
