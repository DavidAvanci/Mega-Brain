# Ilha dinâmica (macOS)

A versão desktop do Mega Brain inclui a ilha nativa SwiftUI portada do Lenke Brain. Requer macOS 14 ou mais recente; Windows e a versão web mantêm a interface habitual.

- Passe o cursor pelo topo central da tela para expandir a ilha.
- A ilha mostra as sessões Claude e Codex ativas da página Agentes, incluindo conversas sem card vinculado, sua atividade e o progresso das etapas dos cards. Agentes aguardando resposta aparecem primeiro. O mascote acompanha os estados de trabalho, pensamento, leitura, edição, testes, espera, conclusão e erro com cores e movimentos próprios.
- Cada execução ocupa uma única linha compacta, com título, atividade e ações. Os perfis Codex têm etiquetas com nome e cor; as cores do mascote continuam indicando o estado da execução.
- Cadastre seus perfis em **Configurações → Ferramentas → Perfis do Codex** ou na aba **Ilha Dinâmica**. Informe a pasta `CODEX_HOME`, nome e cor, escolha o padrão para novas execuções e clique em **Salvar perfis**. A ilha reflete nomes e cores no próximo ciclo de atualização. O menu **Perfis** da ilha controla quais perfis ficam visíveis, sem mudar o padrão de execução. A mesma seleção e a opção de exibir etiquetas ficam disponíveis nas configurações da ilha. Consulte [Perfis do Codex](codex-profiles.md).
- Uma pergunta explícita abre uma caixa na ilha, com os demais agentes em uma linha compacta. Em execuções de cards controladas pelo Mega Brain, a resposta utiliza o mesmo chat e a mesma fila de orientações do modal: aparece como pendente e chega na próxima chamada do agente. A ilha não injeta respostas em uma CLI já em execução nem aprova permissões do provedor.
- Clique no título de uma execução para destacar sua conversa na ilha; a seta abre a conversa completa. **⌘ Enter** envia a resposta e **Esc** fecha a caixa, preservando o rascunho. Em sessões externas, abra a conversa original para responder. Conversas Codex com um identificador de thread abrem diretamente no Codex; sessões sem um link direto abrem a página Agentes. A associação de uma sessão externa a uma pasta de card não configura um canal de resposta.
- Use o alto-falante para ativar ou silenciar os sons dos agentes e tarefas.
- A engrenagem abre **Configurações → Ilha Dinâmica**. Personalize tela, estilo, texto, dimensões, mascote, tamanho do mascote, cores por estado, animações e velocidade, cantos, expansão de perguntas e linha compacta dos demais agentes. As alterações são salvas e refletidas na ilha automaticamente. Use **Ativar ilha dinâmica** para ativar ou desativar a ilha. O controle de sons é independente da visibilidade.

As preferências ficam em `activity-island.json`, junto ao arquivo de configurações do backend. A leitura de atividade não inicia agentes nem avança etapas.

O companion consulta atividade e preferências a cada 650 ms. As configurações são salvas 150 ms após a última alteração; a aba sincroniza mudanças feitas na própria ilha a cada segundo. As conclusões, erros e interrupções observadas permanecem por 15 segundos, com até 10 eventos recentes; o histórico anterior à abertura da ilha não gera novas notificações. Perguntas e atividades usam texto público e entradas de ferramentas, sem exibir conteúdo privado de raciocínio.

`POST /api/activity-island/reply` exige a mesma autenticação Bearer da ilha e recebe `{ taskId, message }`. A execução e sua capacidade de resposta são verificadas novamente no envio. Execuções encerradas, substituídas ou externas retornam um erro recuperável; a resposta de uma execução pertencente ao Mega Brain retorna `delivery: queued` ou `sent`. As mensagens e eventuais falhas de envio ficam disponíveis no chat do card.

## Desenvolvimento e distribuição

Execute `npm run tauri:dev`. O launcher compila o backend e o companion Swift antes de iniciar o Tauri. Para gerar o aplicativo, use `npm run tauri:build`; o comando de preparação de runtime inclui o companion nos recursos macOS.

Execute `npm run test:island-native` no macOS para verificar compatibilidade de preferências, estados, foco, autenticação e recuperação de rascunhos. O teste usa uma sessão HTTP simulada, sem abrir a ilha ou iniciar agentes reais.

O processo nativo inicia após o backend autenticar seu handshake, usa o mesmo token Bearer através do ambiente e encerra junto com o aplicativo. O token não é incluído nos argumentos nem nos arquivos de preferências.

Os sinais de início, resposta pendente, conclusão e erro usam as sequências de áudio do Lenke Brain. O alto-falante da ilha e o controle na aba Ilha Dinâmica compartilham a mesma preferência. Os sons são gerados no WebView, sem arquivos de áudio externos; a primeira reprodução pode depender de interação com o aplicativo.
