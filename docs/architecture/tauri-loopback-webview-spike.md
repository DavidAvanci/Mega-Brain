# Spike de WebView Tauri → API loopback autenticada

Data: 2026-09-01  
Estado: **concluído em Windows nativo**

## O que o spike isola

`spikes/tauri-loopback-auth/` não é importado pelo Mega Brain nem usa Vite. O
Rust inicia `backend.mjs`, que escuta somente em `127.0.0.1` com porta `0`.
Após a porta dinâmica e um token aleatório estarem disponíveis, o Rust os
entrega à WebView pelo comando Tauri `backend_config`. A página faz
`GET /health` com `Authorization: Bearer <token>`.

O servidor só aceita como origem `http://tauri.localhost` ou
`https://tauri.localhost`, responde a preflight com a permissão para
`Authorization` e não registra o token. Fechar a janela mata o filho Node.

## Evidência local obtida

Em WSL, `node spikes/tauri-loopback-auth/smoke.mjs` passou em 2026-09-01:

```text
PASS backend: authenticated dynamic loopback port 35073
```

O teste confirmou uma porta dinâmica, `401` sem token, `200` com o token e o
header CORS exato para `http://tauri.localhost`. O processo temporário foi
encerrado após o teste. A porta 5173 não foi usada.

## Evidência WebView2 no Windows nativo

Em 2026-09-01, o spike foi executado em PowerShell nativo a partir de
`\\wsl.localhost\Ubuntu\home\david\mega-brain\spikes\tauri-loopback-auth`.
A janela WebView2 exibiu:

```text
PASS: http://127.0.0.1:52992/health returned 200 with authenticated dynamic port 52992
```

Após fechar a janela, a consulta de processos `node.exe` cuja linha de comando
continha `backend.mjs` não retornou saída. Isso confirma o acesso autenticado à
porta dinâmica a partir da WebView e o encerramento do backend filho.

## Ressalva

O backend deste spike roda no host Windows para isolar a comunicação WebView ↔
loopback. O próximo item do plano troca essa origem por supervisor Rust → Node
no WSL; esta prova não substitui aquele teste.
