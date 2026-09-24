# Mega Brain

O Mega Brain é um gerenciador de projetos com IA. Em termos simples, é uma interface para organizar tarefas e trabalhar de forma mais automatizada com seus repositórios locais. Cada tarefa vira um card em um quadro: você acompanha o planejamento, a implementação, a revisão e a entrega, enquanto o aplicativo reúne conversas com a IA, arquivos gerados, diffs, worktrees e links de pull requests.

> **Aviso:** este projeto é 100% *vibe coded*. Pode haver *AI slop*: código, textos ou comportamentos gerados por IA que ainda precisam de revisão. Confira as alterações e os comandos antes de usá-los em projetos importantes.

![Quadro atual do Mega Brain com cards fictícios](./board.png)

*Exemplo do quadro com tarefas, progresso e consumo do Claude fictícios.*

## Como funciona

Crie um card com título, descrição e nível de fluxo. Você pode associá-lo a repositórios locais e movê-lo entre as colunas do quadro. Ao entrar em uma coluna com automação, o backend inicia a etapa correspondente; o andamento e eventuais erros aparecem no card. O aplicativo também permite abrir o projeto no editor escolhido, conversar com o agente, inspecionar o diff e iniciar ambientes locais de desenvolvimento.

| Coluna | O que acontece ao colocar um card nela |
| --- | --- |
| **A fazer** | O card fica na fila, sem iniciar uma etapa automática. |
| **Planejando** | A IA prepara os arquivos de planejamento e a checklist de implementação. No fluxo completo, também prepara a checklist de testes. Ao terminar, o card avança conforme o nível de fluxo. |
| **Revisão de plano** | O plano fica disponível para revisão e ajustes antes da implementação. A movimentação para a próxima etapa é manual. |
| **Desenvolvendo** | O agente executa os itens da checklist de implementação nos repositórios da tarefa. Ao terminar, avança para testes no fluxo completo ou para Code Review nos demais fluxos. |
| **Auto Testing** | O agente executa a checklist de testes e, ao concluir, leva o card para Code Review. Essa etapa faz parte do fluxo completo. |
| **Code Review** | Você revisa o diff e o resultado da tarefa. O card aguarda uma decisão manual para seguir. |
| **Staging** | A automação prepara as alterações e abre pull requests para a branch staging dos repositórios associados. Requer GitHub CLI e acesso ao remoto. |
| **Aguardando deploy** | A automação abre pull requests para a branch principal dos repositórios e registra a janela prevista de deploy. Requer GitHub CLI e acesso ao remoto. |
| **Produção** | Marca a entrega como concluída no quadro; não inicia um agente. |

Os níveis de fluxo ajustam as etapas: **Simples** gera apenas a checklist de implementação e pula revisão de plano e testes automáticos; **Médio** gera plano e checklist de implementação, com revisão de plano; **Difícil** inclui plano, revisão e testes automáticos. A movimentação do card pode sincronizar o status com o Jira quando a integração estiver configurada.

## Stack

| Camada | Tecnologias |
| --- | --- |
| Interface | React 19, TypeScript, Vite 6, Tailwind CSS 4 e componentes shadcn/Base UI |
| Quadro | @dnd-kit para arrastar cards entre colunas |
| Backend | Node.js, TypeScript e API HTTP/SSE local |
| Desktop | Tauri 2, Rust e WebView2 |
| Projetos e automações | Git, worktrees, Claude Code ou Codex CLI; GitHub CLI e Jira como integrações opcionais |

Os cards e as preferências ficam em arquivos locais. O backend do aplicativo desktop roda no WSL e atende apenas em 127.0.0.1; veja [a documentação do backend](./server/README.md) para detalhes.

## Compatibilidade atual

| Área | Compatibilidade |
| --- | --- |
| Sistema operacional | Aplicativo desktop desenvolvido para **Windows 11 com WSL2**. O frontend também pode rodar no navegador para desenvolvimento, mas o fluxo desktop Windows → WSL é o caminho principal. Não há pacote desktop validado para macOS ou Linux nativo. |
| Editores | Detecção de Cursor, VS Code, Windsurf, Zed, Sublime Text, IntelliJ IDEA, WebStorm e PyCharm. Também é possível informar o comando de outro editor. O editor precisa estar instalado e acessível no ambiente configurado. |
| IA | **Claude** via Claude Code ou **ChatGPT** via Codex CLI, selecionados nas configurações. As ferramentas correspondentes precisam estar instaladas e autenticadas no WSL para usar chat e etapas automáticas. |
| Repositórios e serviços | Repositórios Git locais; GitHub CLI (gh) para pull requests; Jira opcional para importar tarefas e sincronizar status. |

## Rodar localmente

### Pré-requisitos

- Windows 11 com WSL2 e uma distribuição Linux configurada;
- Node.js 20 e npm no Windows; Node.js 18.19 ou superior, Git, bash e sh no WSL;
- Rust 1.77.2 ou superior, ferramentas MSVC do Visual Studio Build Tools e WebView2 no Windows;
- Claude Code ou Codex CLI no WSL para os recursos de IA;
- GitHub CLI no WSL se você quiser criar e acompanhar pull requests.

Mantenha o checkout do aplicativo no sistema de arquivos do Windows. No **PowerShell**:

```powershell
git clone <URL_DO_REPOSITORIO>
cd mega-brain
npm ci
npm run tauri:dev
```

O comando compila o backend, inicia o Vite e abre o aplicativo desktop. Execute-o no PowerShell, pois o script desktop rejeita Linux/WSLg. Na primeira abertura, escolha o editor, a pasta dos cards, a pasta das worktrees e o provedor de IA. Para cards e worktrees, use caminhos absolutos do WSL, por exemplo /home/usuario/mega-brain-files/workspace.

Para trabalhar apenas na interface web durante o desenvolvimento:

```sh
npm ci
npm run dev
```

O modo web usa os adaptadores de desenvolvimento do Vite; para conferir a integração completa com o backend no WSL, use o aplicativo desktop.

## Documentação

- [Desenvolvimento local do Tauri](./docs/desktop/local-development.md)
- [Pré-requisitos do WSL](./docs/architecture/wsl-prerequisites.md)
- [Empacotamento para Windows](./docs/desktop/windows-packaging.md)
- [Backend e segurança](./server/README.md)

## Licença

Este repositório ainda não contém um arquivo de licença. Consulte os mantenedores antes de redistribuir ou publicar uma versão derivada.
