# Menções a repositórios

Digite `@` na descrição de um card ou no chat para escolher um repositório ativo. A escolha insere `@alias` no texto. Ao enviar uma mensagem ou gerar o prompt de planejamento do card, o servidor resolve o alias no catálogo atual e fornece ao agente o ID, o alias e o caminho validado do checkout.

O texto da menção permanece exatamente como foi escrito no `card.json`. Se o alias for renomeado depois, uma menção antiga deixa de resolver até que o texto seja atualizado. Preservar a identidade após renomeações exigirá metadados próprios com IDs em uma evolução futura. Um `@` desconhecido continua como texto comum.
