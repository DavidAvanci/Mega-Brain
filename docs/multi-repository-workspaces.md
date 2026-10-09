# Workspaces com vários repositórios

Em Repositórios, use a busca por pasta para selecionar um workspace, inclusive pastas formadas por links simbólicos. A descoberta considera checkouts diretos e uma camada de projetos aninhados, ignorando links quebrados e worktrees gerenciadas. Informe um alias e selecione **Cadastrar workspace**. Checkouts já cadastrados são associados ao grupo, sem duplicação. O grupo é persistido nas tags `workspace:<alias>` do catálogo local.

Use `@takeat-core` na descrição do card ou no chat para fornecer ao agente os repositórios ativos do grupo. O planejamento cria uma seção `## <alias-do-repositório>` no `TASK-CHECKLIST.md` para cada checkout envolvido. Use `deps` entre itens para coordenar contratos e documentação entre repositórios.

O executor prepara uma worktree e branch de integração por repositório do checklist. Cada item recebe os caminhos dos demais repositórios preparados para consulta e altera somente sua própria worktree. Commits e integração permanecem separados por checkout. Não execute instalação ou Git na raiz de um workspace que apenas contém links.

npm, Yarn e pnpm são reconhecidos pelo `packageManager` do package.json ou pelos arquivos de configuração e lockfiles. Projetos pnpm usam `pnpm-lock.yaml`, `pnpm install` e `pnpm run <script>`. Não é necessário gerar um package-lock.json.

O grupo local `takeat-core` foi configurado a partir de `/Users/matheuslenke/dev/work/takeat/workspaces/core-takeat`. Novos checkouts adicionados à pasta precisam ser cadastrados no grupo; a descoberta não adiciona projetos automaticamente durante a execução de agentes.

## Chat das execuções

O modal do card mostra **Chat e execuções**, com respostas e ferramentas das etapas e dos itens. O histórico das novas execuções e das conversas de Codex e Claude é persistido em `task-conversation.jsonl` na pasta do card e atualizado automaticamente enquanto o modal está aberto.

É possível enviar mensagens durante uma etapa. Elas ficam pendentes e são incluídas na próxima chamada do agente, com os anexos de conhecimento e as menções resolvidas no envio. Se uma mensagem chegar enquanto o agente implementa um item, ele revisa a implementação após a chamada atual terminar, antes de devolver o item ao executor. A mensagem não interrompe nem altera uma chamada CLI em andamento. Orientações já entregues continuam disponíveis para os itens seguintes. Após a etapa, o chat pode continuar a conversa com o contexto das execuções anteriores.

Não existe limite de turns por item, incluindo desenvolvimento, testes e reparos. Metadados antigos `turns:` e a variável `CHECKLIST_MAX_TURNS` não limitam execuções. Os limites de tempo (`timeoutMin`) e de tentativas (`attempts`) continuam em vigor.
