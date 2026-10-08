# Base de conhecimento

Abra **Conhecimento** na navegação ou na paleta de comandos. Crie pastas e páginas, organize pastas aninhadas e pesquise títulos ou texto. Os controles usam os mesmos ícones, cores e componentes do aplicativo.

## Editor

Digite `/` no início de um bloco para inserir texto, títulos H1–H3, listas, tarefas, citações, código ou divisores. Use a barra que aparece ao selecionar texto para negrito, itálico e links. Atalhos do editor: Ctrl/⌘ B, Ctrl/⌘ I e desfazer/refazer. Importe e exporte arquivos Markdown pelos ícones no cabeçalho.

As alterações são salvas após 700 ms sem digitar. Um rascunho local preserva alterações ainda não salvas, inclusive ao trocar de página. Falhas têm a ação **Tentar novamente**. O histórico registra revisões completas, autor, tarefa e execução; restaurar uma revisão cria uma nova versão.

Em alterações simultâneas, o servidor rejeita a revisão antiga com HTTP 409 e devolve a versão atual. O editor preserva o rascunho e mostra ambas as versões. Edite o rascunho e escolha **Salvar rascunho conciliado**, ou escolha **Usar versão atual**. Não há sobrescrita automática.

## Agentes

Anexe páginas ou pastas ao criar uma tarefa ou na aba Descrição do card. No chat, o ícone de livro abre o seletor de menções. Referências são tipadas e têm IDs estáveis; uma menção textual usa `@nota[page:ID]` ou `@nota[folder:ID]`, independentemente de aliases de repositório.

Ao iniciar um chat ou etapa, as pastas anexadas são resolvidas para suas páginas ativas atuais. Até 24.000 caracteres de contexto são incluídos, com IDs e revisões. Os agentes podem consultar conteúdo adicional pelo adaptador. Agentes dos itens de desenvolvimento/testes também recebem esse contexto.

Mega Brain fornece no ambiente de cada execução um adaptador Node, endereço local e credencial temporária restrita. Comandos:

```sh
"$MEGA_BRAIN_KNOWLEDGE_NODE" "$MEGA_BRAIN_KNOWLEDGE_CLI" list
"$MEGA_BRAIN_KNOWLEDGE_NODE" "$MEGA_BRAIN_KNOWLEDGE_CLI" search autenticação
"$MEGA_BRAIN_KNOWLEDGE_NODE" "$MEGA_BRAIN_KNOWLEDGE_CLI" read ID
"$MEGA_BRAIN_KNOWLEDGE_NODE" "$MEGA_BRAIN_KNOWLEDGE_CLI" create entrada.json
"$MEGA_BRAIN_KNOWLEDGE_NODE" "$MEGA_BRAIN_KNOWLEDGE_CLI" update ID entrada.json
```

Create recebe `{ "title": "Título", "markdown": "Texto", "parentId": null }`. Update recebe `{ "title": "Título", "markdown": "Texto", "baseRevision": 1 }`. Leia antes de editar; em conflito, releia e concilie. Nunca imprima as variáveis de autenticação.

O adaptador funciona com Codex e Claude e no aplicativo empacotado, sem depender de tsx ou npm. Sua credencial expira após 24 horas e no reinício do backend. Ela autoriza somente busca, leitura, criação e edição de páginas, e não dá acesso às demais APIs, à lixeira ou à movimentação. As credenciais gerais do aplicativo não são fornecidas aos agentes.

Agentes externos detectados não recebem ferramentas automaticamente. Para uso externo explícito, é necessário iniciar a sessão com o adaptador e a credencial de uma execução configurada pelo Mega Brain; apenas aparecer na lista de agentes não configura acesso.

## Arquivos e recuperação

A base local fica em `knowledge/catalog.json`, ao lado do arquivo de configurações do Mega Brain. Ela é global entre projetos e independente de branches/worktrees. O catálogo contém pastas, Markdown, IDs e histórico, com escrita atômica. Faça backup desse diretório para transportar ou recuperar suas notas. O arquivo `knowledge/agent.mjs` é gerado novamente ao iniciar agentes e não contém credenciais.

Excluir move para a lixeira. Excluir uma pasta oculta seus descendentes; restaurar a pasta recupera-os. Restaurar uma página cuja pasta ainda está excluída move a página para a raiz. A primeira versão não oferece exclusão permanente, nuvem, bancos de dados ou edição multiplayer.
