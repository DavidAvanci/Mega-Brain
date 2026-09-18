Sem acesso de leitura aos repositórios nesta sessão (permissões de busca negadas), montei o plano com base na descrição do card e no conhecimento do ecossistema — indicando os repositórios da frente de operação, onde vive a listagem de caixas recentes.

# PLAN — ESTR-454: [OPR] Permissão de visualização de caixas recentes

## Contexto — resumo do problema e do resultado esperado

Hoje, quando um usuário é criado com a permissão **"Caixas recentes"** habilitada, a listagem de caixas recentes é restringida pela função **"Caixa por usuário"**: o usuário enxerga apenas os caixas que ele próprio abriu. Esse acoplamento entre a permissão de visualização e o responsável pela abertura do caixa prejudica a operação dos clientes (ex.: gerente de turno que não consegue conferir caixas abertos por outros operadores).

O resultado esperado é desacoplar as duas coisas: a permissão **"Caixas recentes"** passa a controlar apenas o **acesso** à listagem. Com ela habilitada, o usuário vê **todos** os caixas recentes do estabelecimento, independentemente de quem os abriu. Sem ela, o usuário segue sem acesso algum à listagem. A função **"Caixa por usuário"** continua existindo e operando normalmente nas demais telas em que é aplicada (abertura/fechamento e vínculo de operações ao caixa do operador) — só deixa de filtrar a listagem de caixas recentes.

## Especificação — requisitos observáveis e testáveis do comportamento final

1. **Acesso permitido — visão completa:** dado um usuário com a permissão "Caixas recentes" habilitada, quando ele abre a listagem de caixas recentes, então a lista retorna/exibe todos os caixas recentes do estabelecimento, incluindo caixas abertos por outros usuários, sem filtro pelo usuário que abriu.
2. **Acesso negado:** dado um usuário com a permissão "Caixas recentes" desabilitada, quando ele tenta acessar a listagem de caixas recentes, então a listagem não é exibida/retornada (mesmo comportamento de bloqueio atual).
3. **Consulta sem restrição por abridor:** o endpoint/consulta que alimenta a listagem de caixas recentes não aplica mais nenhuma condição pelo usuário que abriu o caixa; a única condição de acesso é a permissão "Caixas recentes" do solicitante.
4. **"Caixa por usuário" preservada:** com a função "Caixa por usuário" ativa, os demais fluxos que dependem dela (ex.: cada operador movimentar apenas o próprio caixa, telas de abertura/fechamento) mantêm o comportamento atual, sem regressão.
5. **Independência das configurações:** o comportamento da listagem de caixas recentes é o mesmo com "Caixa por usuário" ativa ou inativa — o único fator que muda a listagem é a permissão "Caixas recentes".
6. **Detalhe de caixa de terceiro:** um usuário com "Caixas recentes" habilitada consegue abrir o detalhe de um caixa listado que foi aberto por outro usuário (a visualização não pode quebrar por falta de vínculo com o abridor).

## Repositórios

- operation-takeat
- takeat-pos-app

## Tasks

- [ ] Localizar no `operation-takeat` a tela/listagem de "Caixas recentes" e mapear onde o filtro por usuário abridor é aplicado (query/endpoint e/ou filtro em memória no cliente).
- [ ] Localizar como a permissão "Caixas recentes" é checada hoje (gate de acesso à tela/rota) e confirmar que ela é independente da checagem de "Caixa por usuário".
- [ ] Remover, na consulta/endpoint de caixas recentes, a condição que restringe os resultados ao usuário que abriu o caixa quando a permissão "Caixas recentes" está habilitada.
- [ ] Remover o filtro equivalente no lado do cliente (se existir filtragem em memória por usuário na listagem).
- [ ] Manter/reforçar o bloqueio de acesso: sem a permissão "Caixas recentes", a rota/tela e a consulta continuam inacessíveis.
- [ ] Garantir que a tela de detalhe do caixa funciona para caixas abertos por outros usuários (dados do abridor exibidos corretamente, sem erro de autorização).
- [ ] Verificar os demais pontos que usam "Caixa por usuário" (abertura, fechamento, movimentações) e confirmar que nenhum deles foi afetado pela remoção do filtro na listagem.
- [ ] Replicar o mesmo ajuste no `takeat-pos-app`, caso a tela de caixas recentes exista lá com o mesmo filtro (confirmar durante a implementação; se a listagem for alimentada pelo mesmo endpoint já ajustado, validar apenas o comportamento).
- [ ] Atualizar/criar testes automatizados cobrindo: usuário com permissão vê caixas de terceiros; usuário sem permissão é bloqueado; "Caixa por usuário" segue filtrando os fluxos de operação.
- [ ] Rodar lint/build/testes dos repositórios alterados.

## Testes manuais

- [ ] Criar (ou editar) um usuário **com** a permissão "Caixas recentes" habilitada e com "Caixa por usuário" ativa no estabelecimento.
- [ ] Com outro usuário, abrir um caixa; logar com o primeiro usuário e confirmar que o caixa aberto pelo outro aparece na listagem de caixas recentes.
- [ ] Abrir o detalhe desse caixa de terceiro e confirmar que carrega sem erro, exibindo o responsável correto pela abertura.
- [ ] Criar (ou editar) um usuário **sem** a permissão "Caixas recentes" e confirmar que ele não vê a listagem de caixas (tela/menu bloqueado e sem dados retornados).
- [ ] Com "Caixa por usuário" ativa, validar os fluxos de abertura e fechamento de caixa por dois operadores diferentes e confirmar que cada um segue operando apenas o próprio caixa nas telas em que a função se aplica.
- [ ] Repetir a verificação da listagem com "Caixa por usuário" **inativa** e confirmar que o resultado da listagem de caixas recentes é o mesmo (todos os caixas).
- [ ] Se a tela existir no POS (`takeat-pos-app`), repetir os cenários de listagem (com e sem permissão) no app.
