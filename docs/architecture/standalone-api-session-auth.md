# Autenticação da API standalone

O backend independente usa um token opaco, aleatório e efêmero de 32 bytes por execução. Ele escuta exclusivamente em `127.0.0.1`, mas loopback não é uma fronteira de confiança suficiente: qualquer processo local poderia tentar chamar suas rotas.

No desktop, o supervisor Rust cria o token com o gerador criptográfico do sistema e o injeta exclusivamente no ambiente do processo filho como `MEGA_BRAIN_SESSION_TOKEN`. O backend consulta essa variável uma vez durante sua inicialização. Se ela não estiver definida — por exemplo, em uma execução manual do backend — ele gera seu próprio token. O supervisor conserva a mesma string somente na memória para entregá-la à WebView por comando Tauri; ela não é gravada em arquivo, TMP/TEMP, URL, stdout ou stderr.

Cada rota HTTP, inclusive rota inexistente, exige exatamente `Authorization: Bearer <token>`. A comparação usa `timingSafeEqual`. Ainda não existe handshake HTTP público: o handshake futuro do supervisor usa exclusivamente o pipe stdout do processo filho e continua sendo uma tarefa posterior. Assim, nenhuma rota é liberada antes de `/health` e da ready line existirem.

Erros de autorização e erros do adaptador HTTP são genéricos, impedindo reflexo acidental do token. Os testes cobrem token ausente, inválido, esquema incorreto, token válido, rotação e ausência de vazamento em corpos de erro. A camada Vite atual não usa este guard e continua sem token para preservar `npm run dev` em `5173`.
