# Empacotamento Windows

## Escopo do primeiro instalador

O bundle Tauri produz somente NSIS para `x86_64-pc-windows-msvc`. O nome de
produto, identificador e versão são, respectivamente, `Mega Brain`,
`com.megabrain.desktop` e `0.1.0`; `package.json`, `src-tauri/Cargo.toml` e
`src-tauri/tauri.conf.json` precisam usar exatamente a mesma versão antes de
um release.

O instalador é **por usuário** (`currentUser`), sem elevação administrativa,
com atalhos no Menu Iniciar sob `Mega Brain`. Ele bloqueia downgrade. MSI não
é um alvo do primeiro release: só deve ser avaliado se uma exigência de TI
corporativa o tornar necessário.

Os ícones de aplicação, instalador e desinstalador são os arquivos versionados
`src-tauri/icons/icon.png` e `src-tauri/icons/icon.ico`. Não substituir os
ícones por um arquivo obtido durante o build.

## WebView2 e pré-requisitos

O NSIS usa `downloadBootstrapper` silencioso para WebView2. Windows 11 costuma
trazer o Evergreen Runtime, mas uma máquina sem ele precisa de conexão durante
a instalação. O teste de aceitação deve cobrir tanto uma máquina que já o tem
quanto uma VM Windows 11 limpa, e registrar o resultado separadamente.

WSL2 e a distribuição escolhida pelo usuário continuam pré-requisitos do app;
o instalador não instala, não migra nem remove WSL. Node e as integrações WSL
são verificados pelo supervisor na execução.

## Arquivos persistentes e diagnóstico

Os caminhos devem ser obtidos por `AppHandle::path()` no Rust, nunca montados
a partir de um nome de usuário. Em Windows, a política é:

| Tipo | Diretório Tauri | Conteúdo |
| --- | --- | --- |
| Configuração | `app_config_dir()` | `window-state.json`, `wsl-distro.json` e futuras preferências não secretas |
| Logs | `app_log_dir()` | logs JSONL rotacionados/redigidos quando o logger de produção for habilitado |
| Cache | `app_cache_dir()` | dados reconstituíveis; nunca tokens, workspaces ou credenciais |
| Dados de aplicação | `app_data_dir()` | somente estado local que não seja cache; não usar para o workspace WSL |

Em instalações padrão esses diretórios ficam sob os perfis AppData do usuário
e são identificados pelo app Tauri. Os caminhos exatos podem variar conforme a
política do Windows; por isso suporte deve coletá-los pela resolução do app.
O comando Tauri `open_diagnostics_folder` abre somente `app_log_dir()` e não
aceita caminho da WebView; ele não usa API nova do supervisor nem plugin de
shell/filesystem. A interface pode invocá-lo como “Abrir diagnóstico” quando
for adicionada sem expor um seletor de caminhos ou execução arbitrária.

Desinstalar remove apenas os binários/atalhos instalados pelo NSIS. Configuração
AppData, cache, workspaces e `~/.claude`/estado WSL são preservados; a tela de
desinstalação e a documentação de release devem avisar isso.

## Runtime WSL empacotado

O runtime versionado do backend é compilado para dentro do executável Tauri.
Antes de declarar um release instalável, o job de release deve falhar se não
houver, no mínimo:

1. bundle do backend versionado e manifesto de SHA-256 no repositório;
2. executável Tauri que incorpore ambos no instalador;
3. teste que compare o checksum antes da troca atômica do runtime em WSL.

Não incluir `.env.local`, tokens, credenciais Jira, conteúdo de workspace ou
`~/.claude` como recursos do Tauri.

## Build, CI e publicação

Execute o instalador somente em Windows nativo ou no job Windows em
`.github/workflows/windows-release.yml`:

```powershell
npm ci
npm run tauri:build -- --bundles nsis --target x86_64-pc-windows-msvc
```

O workflow constrói frontend, bundle WSL e Tauri em `windows-latest`. Antes do
Tauri, ele confere que `dist/server/main.mjs` existe, que
`runtime-manifest.json` tem schema/versão/entrada válidos e que tamanho e
SHA-256 correspondem ao bundle; também verifica estaticamente que o supervisor
incorpora ambos. Isso não executa `wsl.exe` no CI: aceitação do WSL real
continua sendo feita em Windows 11 + WSL2 configurado pelo usuário.

O workflow produz `Mega-Brain-<versão>-Setup.exe`, `SHA256SUMS.txt` e
`manifest.json`, todos agrupados em artefato nomeado pela revisão fonte. Para
tags `v*`, publica exatamente esses mesmos arquivos em uma GitHub Release. Uma
release já existente faz o job falhar, em vez de substituir assets ou manifesto;
assim o checksum SHA-256 publicado identifica um binário imutável. Verifique-o
com:

```powershell
Get-FileHash .\Mega-Brain-<versão>-Setup.exe -Algorithm SHA256
```

Antes de distribuir para outras máquinas, assine executável e instalador com
certificado de assinatura de código e timestamp RFC 3161. Configure a
assinatura como segredo/infraestrutura do CI, não em `tauri.conf.json` nem no
repositório. Sem assinatura, Windows pode exibir Microsoft Defender SmartScreen
e não há promessa de reputação; o release deve informar claramente esse aviso.
Auto-update permanece desativado até assinatura, rollback do runtime WSL e
instalação/desinstalação em VM limpa estarem validados.

## Checklist manual de aceitação Windows

- VM Windows 11 limpa, WSL2 e uma distribuição configurável;
- WebView2 presente e ausente (com rede disponível para bootstrap);
- instalação, Menu Iniciar, primeira abertura e segundo launch;
- fechamento sem filho WSL órfão;
- desinstalação preservando AppData, workspaces e estado WSL;
- hash do arquivo instalado igual ao `SHA256SUMS.txt` publicado.

Uma execução de `cargo check` no Linux/WSL apenas valida Rust; ela não valida
nem o NSIS, nem WebView2, nem SmartScreen, nem a instalação Windows.
