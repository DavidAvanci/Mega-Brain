# Correções de performance de baixo risco

Implementadas diretamente na branch `master`, em 09/10/2026, a partir da auditoria de 08/10. As alterações locais anteriores do usuário foram preservadas e não fazem parte deste conjunto de correções.

## Mudanças

- **stderr do desktop:** o supervisor continua drenando o pipe até EOF, mas retém apenas os últimos 64 KiB de bytes. O limite funciona também com saída sem quebras de linha e UTF-8 truncado. Diagnósticos recentes continuam disponíveis para classificar falhas; o histórico antigo deixa de ficar acumulado na RAM.
- **Descoberta de editores:** o startup carrega settings primeiro e só consulta editores se o onboarding do backend ou o tour local ainda estiver pendente. A descoberta nas configurações continua disponível. Uma resposta de settings que chega após desmontagem não dispara descoberta tardia.
- **Caches de PR e Jira:** no máximo 1.000 entradas recentes por cache. PRs sem acesso por 24 horas são descartados; estados terminais em uso continuam preservados. Consultas de PR em andamento ficam separadas do cache para evitar duplicação por eviction. A validade de 60 segundos do Jira continua a mesma e entradas expiradas são removidas nas próximas consultas/transições.
- **Smart Diff:** documentos concluídos já persistidos em `diff.json` deixam de ser retidos no mapa do serviço. A leitura continua retornando o documento do disco; reabrir não dispara geração. Jobs ativos permanecem no mapa até concluírem, e o histórico de erros retém no máximo 100 cards.
- **Preferências do diff:** preservadas para os 100 cards acessados mais recentemente. Chaves de arquivos ausentes da revisão atual são removidas dos conjuntos `seen` e `collapsed`.
- **Ações manuais de status:** cache limitado a 1.000 cards; marcadores vencidos são descartados durante refresh/movimentação. A janela de supressão de notificações continua sendo de dez segundos.
- **Typecheck:** removido um import não utilizado de `DialogDescription` em NewCard, que já impedia a checagem de tipos antes destas correções. Sem alteração do comportamento do formulário.

O descarte afeta apenas dados recuperáveis: um PR/Jira antigo pode precisar de nova consulta e preferências de colapso de um card fora dos últimos 100 podem voltar ao padrão. Revisões persistidas, cards, prompts e configuração de onboarding não são apagados.

Não foram alterados polling, avanço automático de etapas, housekeeping do quadro, protocolo WSL, instalação do runtime, virtualização ou cancelamento de ações.

## Validação

- **27 testes direcionados TypeScript/React passaram**, cobrindo overflow/expiração do cache, estados de PR, ausência de consultas duplicadas em andamento, Jira, Smart Diff persistido, abertura do diff, movimentações otimistas, notificações e onboarding.
- **31 testes Rust passaram; dois testes de integração com WSL real foram ignorados**, conforme já configurados no repositório. Os novos testes drenam 10 MiB sem newline, verificam o limite do tail, preservação do diagnóstico final e UTF-8.
- **TypeScript (`tsc --noEmit`) passou.** ESLint dos arquivos da correção passou; o arquivo NewCard mantém um warning anterior de dependência de effect, fora do escopo desta mudança.
- **Build Vite de produção passou**, com saída temporária para preservar `dist`. JS inicial: 635,59 kB minificado / 209,06 kB gzip. Essas correções reduzem retenção e trabalho no startup; não pretendem reduzir o bundle.
- **Suíte completa: 365 testes passaram e 55 falharam.** Uma cópia temporária do estado anterior às correções, preservando as alterações locais anteriores, teve 353 aprovados e 56 falhas. Foram comparados os nomes: 53 das 55 falhas atuais também falham na baseline. As outras duas são testes de scripts/worktrees que encontram diretórios residuais no checkout atual; os arquivos dos testes e suas dependências diretas são idênticos nas duas cópias. A cópia temporária tem diretório base diferente. Não foram removidas worktrees residuais nem modificadas essas áreas para forçar a suíte a passar.

A suíte completa permanece sem aprovação. As falhas incluem incompatibilidades de paths/symlinks no Windows, fixtures/configuração de repositórios e expectativas anteriores de UI/contratos. Os resultados não substituem um teste real do desktop/WSL ou profiling de uma sessão longa; não foi calculado ganho percentual de startup/RAM.
