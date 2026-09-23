# Spike: janela Tauri → supervisor Rust → health do Node no WSL

Data: 2026-09-01  
Estado: **validado em Windows nativo em 2026-09-01**

## Escopo isolado

O spike estende apenas `spikes/tauri-loopback-auth/` e não é importado pelo
Mega Brain, não inicia Vite e não usa a porta 5173. O novo binário
`tauri-wsl-supervisor-spike` inicia no Windows:

```text
WebView Tauri
  → comando Rust backend_config
  → Rust: wsl.exe -d Ubuntu -- node backend-wsl.mjs
  → Node WSL: 127.0.0.1:porta-aleatória/health
```

O Node publica uma única linha JSON de prontidão com porta, token efêmero e
PID. O Rust consome essa linha, entrega token/endpoint somente à WebView e, ao
fechar a janela, envia `SIGTERM` ao PID pelo `wsl.exe`; após dois segundos, só
então usa finalização forçada do processo `wsl.exe` como fallback.

## Validação obtida no WSL

`node spikes/tauri-loopback-auth/wsl-smoke.mjs` passou em 2026-09-01:

```text
PASS WSL backend: authenticated dynamic port 42957; clean SIGTERM for PID 211700
```

Esse teste confirma porta dinâmica, `401` sem token, `200` com token, PID
consistente e encerramento limpo do backend. Ele foi executado sem Vite e o
processo temporário foi encerrado.

## Procedimento de confirmação Windows

Em PowerShell nativo:

```powershell
Set-Location \\wsl.localhost\Ubuntu\home\user\mega-brain\spikes\tauri-loopback-auth
$env:CARGO_INCREMENTAL = "0"
$env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA "MegaBrain\tauri-spike-target"
cargo run --bin tauri-wsl-supervisor-spike
```

A janela deve apresentar `PASS: http://127.0.0.1:<porta>/health returned 200
with authenticated dynamic port <porta>`. Feche-a e confirme a ausência de
órfão:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*backend-wsl.mjs*" }
```

O comando não deve produzir saída.

## Evidência obtida em Windows nativo

O binário foi compilado e executado no PowerShell nativo com o diretório de
artefatos do Cargo fora do compartilhamento WSL. A janela Tauri apresentou:

```text
PASS: http://127.0.0.1:39081/health returned 200 with authenticated dynamic port 39081
```

Depois de fechar a janela, a consulta por `node.exe` cujo comando contém
`backend-wsl.mjs` não produziu saída. Isso confirma o caminho completo entre
WebView Tauri, supervisor Rust, backend Node no WSL e `/health`, além do
encerramento sem processo Node órfão.
