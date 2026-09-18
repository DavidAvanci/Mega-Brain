# Pré-requisitos WSL reais — Mega Brain Desktop

Registro da Fase 0 para a primeira versão desktop: o backend continuará no
WSL, pois os workspaces, as sessões do Claude e os comandos existentes já
residem ali. Esta lista reflete a máquina de desenvolvimento verificada em
2026-09-01; o instalador deve validar os itens obrigatórios e apresentar uma
mensagem acionável para cada ausência.

## Ambiente verificado

| Item | Valor encontrado | Uso |
| --- | --- | --- |
| Runtime | WSL2 (kernel `6.18.33.2-microsoft-standard-WSL2`) | Execução do backend e dos comandos atuais. |
| Distribuição | Ubuntu 24.04.4 LTS (`noble`) | Distribuição atualmente usada pelos workspaces. O desktop não deve assumir este nome: ele deve permitir selecionar a distribuição. |
| Node.js | `v18.19.1` | Runtime do backend e dos scripts TypeScript. Para a primeira versão, exigir Node 18.19 ou superior; o Vite 6 e as dependências atuais já funcionam nesta versão. |
| npm | `9.2.0` | Instalação/validação das dependências do runtime durante desenvolvimento. |
| Git | `2.43.0` em `/usr/bin/git` | Diffs, worktrees, status e operações de ambiente dev. |
| GitHub CLI | `gh 2.45.0` em `/usr/bin/gh` | Consulta de status e abertura de PRs; opcional somente se esses recursos não forem usados. |
| Claude Code | `2.1.257` em `~/.local/bin/claude` | Agentes, chat, histórico em `~/.claude` e medição de uso; obrigatório para esses fluxos. |
| `tsx` | `node_modules/.bin/tsx` (`4.23.12`) | Execução dos scripts de etapas/checklists. É uma dependência do projeto, não um requisito global. |
| Shells | `/usr/bin/bash` e `/usr/bin/sh` | Execução dos comandos e scripts existentes. |

## Acesso a executáveis Windows

O WSL desta máquina expõe o disco do Windows em `/mnt/c` e resolve os
executáveis Windows pelo PATH. Foram encontrados:

| Executável | Localização/estado | Recurso que depende dele |
| --- | --- | --- |
| `powershell.exe` | `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe` | Botão Café e restauração do estado de energia. |
| `wsl.exe` | `/mnt/c/Windows/System32/wsl.exe` | Windows Terminal iniciado pelo app atual. |
| `wt.exe` | disponível no PATH do WSL via WindowsApps | Retomar Claude no Windows Terminal. |
| `cursor` | disponível no PATH via instalação do Cursor | Abrir card no editor. |
| `chrome.exe` | `/mnt/c/Program Files/Google/Chrome/Application/chrome.exe` | Abrir URLs de PR. |

`cursor`, `wt.exe` e Chrome são integrações opcionais: a interface deve
informar sua ausência ao executar a ação, sem impedir o board de iniciar.
PowerShell é necessário apenas para o Café; a funcionalidade deve ficar
indisponível com explicação caso ele não possa ser executado. O acesso a
`/mnt/c` e a interoperabilidade de executáveis Windows são obrigatórios para
preservar essas integrações sem reescrita.

## Configuração e dados que devem permanecer no WSL

- `WORKSPACE_DIR` (ou o padrão `./mega-brain-files/workspace`) precisa apontar para os cards e
  repositórios já existentes.
- `~/.claude`, incluindo `projects/` e `.credentials.json`, deve permanecer
  no perfil do usuário WSL; o instalador não copia esses dados para Windows.
- As variáveis `JIRA_SITE`, `JIRA_EMAIL` e `JIRA_API_TOKEN` continuam
  opcionais: sem elas, as rotas Jira retornam os comportamentos vazios atuais.
- O PATH do processo iniciado pelo supervisor deve incluir `~/.local/bin`,
  pois é onde o `claude` desta instalação está localizado. Não se pode supor
  que `wsl.exe` carregue o shell de login do usuário.

## Validações de bootstrap propostas

Antes de iniciar o backend, o supervisor deve verificar na distribuição WSL
escolhida: versão do Node, `git`, diretório do runtime, `WORKSPACE_DIR` e
acesso de escrita ao diretório de logs. Ele deve verificar `claude` e `gh`
separadamente para poder manter o board disponível e desabilitar apenas os
recursos dependentes. As verificações dos executáveis Windows devem ocorrer
no momento da ação correspondente, não no boot.

Durante esta inspeção, `tsx --version` encontrou um `TEMP` herdado que aponta
para um diretório Windows inexistente no WSL. O binário local de `tsx` foi
resolvido corretamente, mas o runtime deve definir um diretório temporário
gravável no WSL (por exemplo, `/tmp`) ao iniciar scripts, em vez de depender
de `TEMP`/`TMP` herdados do Windows.
