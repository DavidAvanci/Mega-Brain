# Modelos e efforts do Codex

O Mega Brain consulta `codex app-server` com `model/list` para montar as opções
de modelos e os efforts suportados pelo perfil ativo. O catálogo é mantido por
cinco minutos por pasta de perfil. O botão de atualizar consulta novamente;
salvar uma troca de perfil também atualiza a lista. A consulta não inicia uma
tarefa nem consome um turno de geração.

Sem acesso ao CLI, a interface identifica o catálogo de referência. Ele inclui
GPT-6.1 Sol, GPT-6 Astra, GPT-6 Sol, GPT-6 Luna e os modelos GPT-5.6 Sol, Terra
e Luna. A disponibilidade real depende do cliente e da conta. Modelos ocultos
não entram na lista; um modelo anteriormente salvo continua visível para que
seja possível revisar a configuração sem substituí-lo automaticamente.

Os padrões ao escolher Codex são recomendações do Mega Brain por etapa:

| Etapa              | Modelo preferido | Effort | Uso                             |
| ------------------ | ---------------- | ------ | ------------------------------- |
| Planejamento       | GPT-6.1 Sol      | High   | Plano, decisões e checklists    |
| Desenvolvimento    | GPT-6.1 Sol      | Medium | Implementação dos itens         |
| Testes automáticos | GPT-6 Luna       | High   | Cenários definidos e repetíveis |

Se esses modelos não constarem no catálogo do perfil, usa-se o modelo automático
ou outra opção disponível para preservar a função de cada etapa. As escolhas
explicitamente salvas, incluindo GPT-5.6, são preservadas. Os antigos aliases
Claude são convertidos para padrões Codex apenas quando o provedor é Codex.

Low prioriza rapidez; Medium equilibra profundidade e tempo; High e X-high
aprofundam a análise. Max dedica mais raciocínio a uma tarefa. Ultra acrescenta
delegação automática a subagentes e só aparece quando o modelo suporta essa
opção. GPT-6 Luna e GPT-5.6 Luna suportam até Max, sem Ultra. Mais effort pode
aumentar tempo e consumo; Ultra não é o padrão de nenhuma etapa.

Ao trocar de modelo, o effort é mantido se compatível; caso contrário, usa-se
o padrão informado pelo novo modelo. O backend também rejeita combinações
incompatíveis antes de salvar. A escolha Automático mantém a configuração do
Codex: `config/read` informa o modelo efetivo para filtrar os efforts, e as
execuções omitem `--model`. Os valores escolhidos são enviados a `codex exec`
com `--model` e `--config model_reasoning_effort="..."`.

Referências verificadas em 8 de outubro de 2026:
[Modelos do Codex](https://learn.chatgpt.com/docs/models) e
[Descoberta pelo App Server](https://learn.chatgpt.com/docs/app-server#list-models-modellist).
