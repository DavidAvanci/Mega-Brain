# Medição de inicialização e diagnósticos do supervisor WSL

Data: 2026-09-01  
Estado: **concluído no spike isolado**

## Escopo e método

O trabalho está restrito a `spikes/tauri-loopback-auth/`. Ele não importa o
aplicativo, não altera WSL, não inicia Vite e usa apenas a porta aleatória do
backend temporário em `127.0.0.1`.

`startup-benchmark.mjs` inicia `backend-wsl.mjs`, aguarda a linha JSON de
prontidão, chama `/health` com o token efêmero e envia `SIGTERM`. Foram feitas
dez execuções consecutivas em 2026-09-01. O tempo `ready` vai do spawn do Node
até a linha de prontidão; `usable` inclui o `GET /health` autenticado.

| Medida | Mínimo | Mediana | P95 | Máximo |
| --- | ---: | ---: | ---: | ---: |
| `ready` | 75.0 ms | 78.0 ms | 114.2 ms | 114.2 ms |
| `usable` | 81.8 ms | 88.1 ms | 122.8 ms | 122.8 ms |

Esses números medem o bootstrap do backend no WSL, não o cold start completo
do executável Tauri/WebView no Windows; essa medida de produto pertence à Fase
8. Cada processo temporário foi encerrado ao fim da amostra.

Para repetir no WSL:

```bash
cd /home/david/mega-brain/spikes/tauri-loopback-auth
node startup-benchmark.mjs
```

Defina `MEGA_BRAIN_BENCHMARK_RUNS` para mudar o número de amostras.

## Falhas e mensagens acionáveis

O supervisor do spike agora aguarda a prontidão por até 10 segundos, captura
stderr do `wsl.exe`/backend e encerra o filho quando a prontidão falha. Ele
classifica os casos abaixo sem expor token algum:

| Caso | Mensagem exibida |
| --- | --- |
| WSL ausente ou indisponível | `O WSL não está disponível. Instale ou repare o WSL, reinicie o Windows e abra o Mega Brain novamente.` |
| Node ausente na distribuição selecionada | `O Node.js não está disponível na distribuição WSL selecionada. Instale o Node.js 18.19 ou superior no WSL e abra o Mega Brain novamente.` |
| Backend encerra, emite prontidão inválida ou falha internamente | `O backend do Mega Brain falhou antes de ficar pronto. Consulte os logs de diagnóstico e confirme o runtime e o bundle do backend.` |
| Não há prontidão em 10 segundos | `O backend do Mega Brain demorou demais para iniciar. Consulte os logs de diagnóstico e tente abrir o app novamente.` |

O detalhe técnico do stderr é anexado apenas ao diagnóstico do processo. O
produto deverá direcionar esse detalhe para os logs, mantendo a primeira frase
como a mensagem curta da interface.

## Validação determinística dos erros

`src/supervisor_diagnostics.rs` contém classificadores puros e cinco testes:
WSL indisponível, Node indisponível, falha genérica e cenário de timeout
injetado. A validação executada foi:

```bash
rustc --test src/supervisor_diagnostics.rs -o /tmp/mega-brain-supervisor-diagnostics-test
/tmp/mega-brain-supervisor-diagnostics-test
```

Resultado: 5 aprovados, 0 falhos.

No Windows nativo, os mesmos caminhos podem ser demonstrados sem remover WSL
nem alterar o PATH, usando somente o gancho exclusivo do spike:

```powershell
$env:MEGA_BRAIN_SUPERVISOR_TEST_SCENARIO = "wsl-unavailable" # ou node-unavailable, backend-failed, backend-timeout
cargo run --bin tauri-wsl-supervisor-spike
Remove-Item Env:MEGA_BRAIN_SUPERVISOR_TEST_SCENARIO
```

O comando falha antes de criar `wsl.exe` ou Node e imprime a mensagem esperada.
Esse gancho não deve ser levado para o aplicativo de produção.

## Ressalvas

- O `cargo test --bin tauri-wsl-supervisor-spike` no WSL não é um teste válido
  do binário Windows: a configuração Tauri do spike referencia apenas o ícone
  `.ico` requerido pelo Windows e o macro Linux pede um `.png`.
- O build/execução Windows do spike já foi validado antes desta mudança; a
  recompilação do supervisor alterado deve ser feita no PowerShell nativo antes
  de promover o código para a Fase 4.
