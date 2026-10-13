# Triagem de cards com Jev (TypeSafe)

## Seleção de modelo e effort do planejamento

Com o Jev habilitado, **Configurações → Prompts e modelos → Planejamento** oferece o checkbox **Usar o Jev**. Ao marcar, os controles de modelo e effort ficam ocultos; ao desmarcar, reaparecem. A opção vale apenas para o planejamento e funciona com Claude Code e Codex.

Antes de cada nova execução, o backend envia título e descrição à TypeSafe com duas perguntas Choice independentes na mesma chamada: `planningModel` escolhe o modelo; `planningEffort` escolhe a profundidade de raciocínio. Não há perfis que amarrem modelo e effort, nem uma regra que derive essas escolhas do fluxo Simples/Médio/Difícil.

No Codex, as opções de modelo vêm do catálogo do perfil ativo. A pergunta sobre esforço inclui os valores suportados por pelo menos um modelo; depois das duas respostas, o backend valida a combinação. Quando o esforço escolhido não é suportado pelo modelo, aplica o padrão compatível desse modelo e registra a escolha original e o ajuste. Em empates, usa a primeira opção na ordem enviada.

O effort salvo é preservado enquanto os controles estão ocultos. Se o Jev estiver desabilitado, sem chave, indisponível ou retornar uma resposta inválida, o planejamento usa o modelo padrão da etapa e o effort salvo, ajustado quando necessário. Se o catálogo ao vivo do Codex não puder ser consultado, a seleção também usa esse fallback sem pedir ao Jev que escolha entre modelos cuja disponibilidade não foi confirmada.

Cada decisão fica em `planning-selection.json` na pasta do card, com probabilidades separadas, modelo efetivo do Jev, versão da política, modelo e effort de execução, origem e eventual motivo do fallback. `agent.json` guarda a decisão da execução. Cancelar durante a consulta impede o início tardio do agente; editar título ou descrição durante a consulta invalida o resultado e consulta novamente. Retomar uma execução pausada preserva modelo e effort, sem uma nova consulta ao Jev.

## Triagem de dificuldade

Em **Configurações → Ferramentas → Triagem de cards**, habilite Jev e cadastre uma chave da TypeSafe. A origem padrão é `https://api.typesafe.ai`; deixe o campo de URL vazio para usá-la. Uma origem alternativa deve usar HTTPS, sem caminho, query ou credenciais.

Também é possível definir `TYPESAFE_API_KEY` e, opcionalmente, `TYPESAFE_BASE_URL` no backend. Cada variável tem precedência sobre o valor salvo na interface. A chave fica somente no backend e nunca é devolvida ao navegador. “Configurada” significa chave presente e origem válida, sem comprovar conexão ou autenticação.

## Migração da Laya

As antigas chaves, URLs e variáveis `LAYA_*` não são usadas pelo Jev. Cadastre uma nova chave TypeSafe e habilite a triagem novamente. O gateway local deixa de ser necessário. Título e descrição passam a ser enviados ao serviço da TypeSafe quando você solicita uma análise.

## Comportamento

Com Jev habilitado, clique em **Analisar com Jev** no formulário de novo card. O backend envia somente título e descrição e uma pergunta Choice sobre dificuldade, com as opções `simples`, `medio` e `dificil`. Após receber a resposta, o card é criado automaticamente no fluxo de maior probabilidade. Em empate, prevalece a primeira opção na ordem Simples, Médio e Difícil. As três porcentagens e a versão efetiva do modelo aparecem no resultado.

O cliente chama `POST /v1/systemone` com `model: "jev-latest"` e autenticação Bearer. Valida o campo superior `model`, as probabilidades, a escolha, a confiança e os tokens usados. A política `card-triage-jev-3-max-probability-auto-create` identifica o contrato. A versão efetiva vem do campo `model` da resposta; não há dependência de `routing` ou cabeçalhos do gateway Laya.

Resultados podem ser reutilizados por cinco minutos; o cache distingue conteúdo, credencial, origem, workspace, modelo e política. Há no máximo uma chamada em andamento e timeout de 30 segundos. HTTP 401 indica chave inválida, 429 indica limite e 529 indica sobrecarga; Retry-After é respeitado quando presente. Em falhas, **Criar sem sugestão (Difícil)** continua disponível. Desabilitar Jev restaura a escolha manual do fluxo.

A chave salva fica nas preferências locais com gravação atômica e modo 0600. **Remover chave salva** elimina apenas a chave persistida; uma chave de ambiente continua ativa enquanto a variável estiver definida.

## Avaliação

Use `npm run card-triage:evaluate -- --input dataset.json --mode replay` para avaliar respostas gravadas sem chamadas externas. O dataset contém `examples` com `id`, `split`, `label`, `title`, `description` e `answers` com a resposta JSON completa da TypeSafe, incluindo `model`, `answers` e `usage`.

O modo live é explícito: `npm run card-triage:evaluate -- --input dataset.json --mode live --budget N`. Requer `TYPESAFE_API_KEY`; `TYPESAFE_BASE_URL` é opcional. Use exemplos anonimizados e orçamento autorizado. A saída contém somente métricas agregadas.

Referências: [Introdução](https://docs.typesafe.ai/introduction), [API](https://docs.typesafe.ai/api) e [modelos](https://docs.typesafe.ai/models).
