# PLAN — ESTR-435: [OPR] Banner de aviso na topbar - Nova OPR

## Contexto — resumo do problema e do resultado esperado
A Takeat vai migrar os clientes do painel de operação atual (operação antiga) para o novo modelo de operação (Nova OPR). Hoje os clientes trabalham no painel atual e não têm nenhum aviso dentro do produto sobre essa mudança. O resultado esperado é um banner de aviso posicionado entre o header (topbar) e o conteúdo da página do painel atual, comunicando a migração, com um botão "Conheça as novidades" que abre um modal apresentando os quatro vídeos sobre as frentes impactadas (Fluxo de Pedidos, Fluxo de Vendas no Modo Balcão, Conferência de Caixa e Pagamento de Mesas e Comandas), e com a possibilidade de o usuário fechar o aviso. O banner e o modal devem ser construídos com os componentes do `takeat-design-system-ui-kit` sempre que houver componente equivalente disponível.

## Especificação — requisitos observáveis e testáveis do comportamento final
- O banner é renderizado imediatamente abaixo do header (topbar) e acima do conteúdo da página, ocupando a largura disponível, visível em todas as telas do painel atual que exibem o header, sem sobrepor nem quebrar os elementos existentes do header nem o conteúdo abaixo dele (o conteúdo é empurrado para baixo, não coberto).
- O banner, o botão "Conheça as novidades", o botão de fechar e o modal usam componentes do `takeat-design-system-ui-kit` sempre que existir equivalente na biblioteca (ex.: `Button`, componente de modal/dialog, ícones via subpath de ícones, tipografia e tokens do tema via `UiKitTheme`); só se cria markup/estilo próprio para o que a biblioteca não cobre.
- O texto do banner comunica que a operação será atualizada para o novo modelo. O texto final deve ser proposto e aprovado pelo time de produto antes do merge.
- O banner contém o botão "Conheça as novidades"; ao clicar, abre um modal (sem navegar para fora do painel) listando os quatro vídeos citados no card do Jira, um por frente impactada: Fluxo de Pedidos, Fluxo de Vendas no Modo Balcão, Conferência de Caixa e Pagamento de Mesas e Comandas.
- Cada item do modal tem título da frente e link/thumbnail do vídeo correspondente; os links abrem em nova aba (`target="_blank"` com `rel="noopener"`) usando as URLs dos vídeos indicadas no card do Jira.
- O modal pode ser fechado pelo X, por clique fora (overlay) e pela tecla Esc, conforme o comportamento padrão do componente de modal do ui-kit; fechar o modal não fecha o banner.
- O banner contém um botão de fechar (X); ao clicar, o banner desaparece imediatamente sem recarregar a página e o conteúdo volta a ocupar o espaço liberado.
- O estado de dismiss é persistido (ex.: `localStorage`) por usuário/navegador: após fechar, o banner não reaparece em navegações internas nem após recarregar a página ou refazer login no mesmo navegador. Fechar apenas o modal não persiste dismiss algum.
- A chave de persistência é versionada (ex.: `@garcom:novaOprBanner:v1`), permitindo reexibir o aviso no futuro em uma nova campanha apenas trocando a versão.
- O layout do banner e do modal segue o protótipo do card (cores, ícone, tipografia via tokens do ui-kit) e é responsivo: em larguras menores o conteúdo não estoura a largura da tela nem esconde o botão de fechar, e o modal se ajusta à viewport com os quatro itens acessíveis (scroll interno se necessário).
- Usuários que nunca fecharam o banner o veem por padrão; nenhuma configuração de backend é necessária para exibi-lo.

## Repositórios
- garcom-restaurant-dashboard

## Tasks
- [x] Validar com produto o texto final do aviso e confirmar as URLs dos quatro vídeos citados no card (Fluxo de Pedidos, Fluxo de Vendas no Modo Balcão, Conferência de Caixa, Pagamento de Mesas e Comandas).
- [x] Verificar a viabilidade do `takeat-design-system-ui-kit` no `garcom-restaurant-dashboard`: instalar/atualizar o pacote, checar compatibilidade da versão de React com o peer range da lib, configurar o wrapper `UiKitTheme` e o import do CSS da lib (atenção ao mapa de `exports` do pacote, que pode exigir alias/ajuste no bundler para expor o CSS), e listar quais componentes da lib cobrem banner, botão, ícones e modal.
- [x] Localizar o layout do painel (header + área de conteúdo) e mapear o ponto de montagem do banner entre o header e o conteúdo, garantindo que ele apareça em todas as telas que usam esse layout.
- [x] Criar o componente `NewOperationBanner` (texto, botão "Conheça as novidades", botão de fechar) usando os componentes e tokens do ui-kit, seguindo o protótipo do card.
- [x] Criar o modal de novidades com o componente de modal/dialog do ui-kit, com os quatro itens de vídeo, cada um com título da frente e link abrindo em nova aba com `rel="noopener"`.
- [x] Ligar o botão "Conheça as novidades" à abertura do modal e validar o fechamento por X, clique no overlay e tecla Esc pelo comportamento do componente do ui-kit.
- [x] Implementar a persistência do dismiss do banner em `localStorage` com chave versionada e hook/util de leitura na montagem para decidir a renderização.
- [x] Integrar o banner ao layout entre o header e o conteúdo, condicionado ao estado de dismiss, garantindo que o conteúdo seja empurrado (sem sobreposição) quando o banner está visível.
- [x] Ajustar responsividade e estados visuais do banner e do modal (hover dos botões e dos links, truncamento/quebra do texto em telas menores, scroll interno do modal se necessário), preferindo os estados nativos dos componentes do ui-kit.
- [x] Revisar com produto o texto renderizado e o conteúdo do modal (aviso proposto e aprovado — critério de aceite) e aplicar ajustes finais.
- [x] Abrir PR com screenshot/GIF do banner e do modal (exibição, abertura do modal e fechamento) para revisão.

## Testes manuais
- [x] Acessar o painel atual com um navegador sem estado prévio e verificar que o banner aparece entre o header e o conteúdo em todas as telas principais (pedidos, balcão, caixa, mesas/comandas), sem cobrir o header nem o conteúdo.
- [x] Conferir que o texto exibido é o aprovado por produto e que o visual do banner e do modal usa os componentes/tokens do ui-kit conforme o protótipo.
- [x] Clicar em "Conheça as novidades" e verificar que o modal abre com os quatro vídeos: Fluxo de Pedidos, Fluxo de Vendas no Modo Balcão, Conferência de Caixa e Pagamento de Mesas e Comandas.
- [x] Clicar em cada um dos quatro links do modal e verificar que o vídeo correto abre em nova aba, conforme as URLs do card.
- [x] Fechar o modal pelo X, por clique fora e pela tecla Esc; em todos os casos o banner deve continuar visível.
- [x] Clicar no X do banner e verificar que ele some imediatamente, sem recarregar a página, e que o conteúdo sobe ocupando o espaço liberado.
- [x] Recarregar a página, navegar entre telas e refazer login: o banner não deve reaparecer no mesmo navegador.
- [x] Limpar o `localStorage` (ou usar aba anônima) e verificar que o banner volta a aparecer.
- [x] Testar em larguras reduzidas (notebook pequeno e janela estreita): o banner não deve estourar a largura nem esconder o botão de fechar, e o modal deve caber na viewport com os quatro itens acessíveis.
- [x] Verificar que o header e o restante do painel continuam funcionais (menus, status, ações) com o banner visível, com o modal aberto e após fechá-los, e que nenhuma outra tela teve o layout quebrado pelo espaço do banner.
