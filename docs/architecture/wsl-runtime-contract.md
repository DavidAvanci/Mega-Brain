# Contrato do runtime WSL

O bundle do backend é identificado por `dist/server/runtime-manifest.json`.
O manifesto versionado (`schemaVersion: 1`) contém apenas a versão do runtime,
o entrypoint fixo `main.mjs`, tamanho e SHA-256. Ele não contém configuração,
tokens, `.env.local` ou credenciais.

O destino do instalador no WSL é:

```text
~/.local/share/mega-brain/runtime/<runtimeVersion>/main.mjs
```

Versões são validadas como um único nome de diretório antes de montar o caminho;
assim, o bootstrap não escreve no checkout nem aceita traversal.

## Materialização e upgrade

No build, `main.mjs` e este manifesto são incorporados no executável Tauri. Na
abertura, o supervisor transfere somente o bundle pelo `stdin` para a distro WSL
selecionada. O WSL cria um diretório temporário dentro do diretório de runtime,
confere tamanho e `sha256sum`, grava o manifesto sem segredos e renomeia o
diretório para a versão final somente após a validação. Uma versão já existente
é imutável: colisão com conteúdo inválido falha, nunca a substitui.

O processo candidato é iniciado a partir de
`~/.local/share/mega-brain/runtime/<versão>/main.mjs`. Depois do handshake, o
supervisor chama `/health` com o token efêmero. Só com resposta 200 ele troca,
por rename atômico, o symlink `runtime/active` para a nova versão. Se a cópia,
checksum, handshake ou health falhar, o symlink anterior não é tocado e o filho
candidato é encerrado — isto é o rollback transacional. Runtimes anteriores são
mantidos; esta fase não executa limpeza automática, evitando apagar uma versão
recuperável. Qualquer limpeza futura deverá limitar-se a diretórios de versão
validados abaixo desse root e jamais atingir workspace ou configuração.

O bundle e o manifesto não carregam `.env`, `.env.local`, tokens nem
credenciais. O processo continua usando `HOME`, `PATH` e `~/.claude` do usuário
WSL. Em release não há fallback para o checkout. Apenas builds Rust de debug
aceitam `MEGA_BRAIN_WSL_BACKEND_PATH`, para preservar o ciclo local de
desenvolvimento.

Enquanto o binário Linux autocontido não for aprovado, o supervisor consulta
`node --version` na distribuição escolhida antes de iniciar o backend. O mínimo
é Node 18.19.0; ausência, saída inválida e versões inferiores retornam o código
estável `runtime-unavailable`. O caminho antigo do checkout continua apenas
como fallback de desenvolvimento até o instalador materializar o runtime.
