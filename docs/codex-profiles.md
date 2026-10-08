# Perfis do Codex

O Mega Brain pode acompanhar vários diretórios Codex simultaneamente. Cada perfil identifica uma pasta `CODEX_HOME` existente, com suas sessões e configurações próprias.

Em **Configurações → Ferramentas → Perfis do Codex**, adicione os perfis com nome, pasta e cor. Pastas locais `.codex`, `.codex-*` e `.codex_*` com configuração ou sessões são encontradas automaticamente. Outros caminhos podem ser informados manualmente; caminhos absolutos e `~/` são aceitos. Caminhos equivalentes ou ligados por symlink não podem representar dois perfis diferentes.

Selecione **Padrão para novas execuções** e use **Salvar perfis**. O padrão é aplicado às próximas chamadas Codex do chat de cards e às próximas etapas de workflow. Uma etapa já iniciada mantém o ambiente original, inclusive nas chamadas seguintes dos seus executores. A troca não interrompe processos existentes. O histórico do chat e os metadados da etapa registram a identidade do perfil utilizado.

O indicador de consumo mostra o perfil padrão e consulta seu diretório Codex. Leituras e caches ficam separados por pasta. Salvar uma mudança de perfil atualiza o indicador imediatamente; uma conta sem leitura disponível não herda os percentuais de outra conta.

A página **Agentes** mostra nome e cor do perfil e permite filtrar as sessões. A ilha usa os mesmos perfis e uma linha por execução. Seu menu **Perfis** e a aba **Ilha Dinâmica** permitem ocultar perfis e escolher se as etiquetas aparecem. Essas preferências controlam a apresentação; o padrão das novas execuções é independente. Ocultar o perfil de uma pergunta fecha a caixa e preserva o rascunho para quando ela for reaberta.

Sessões com o mesmo identificador em diretórios diferentes permanecem separadas. Agentes externos são associados pelo diretório de sessões e, quando disponível, pelo ambiente do processo; o diretório do repositório sozinho não determina o perfil. Daemons `codex app-server` não aparecem como execuções independentes. A configuração de um perfil não autentica uma conta nem fornece o adaptador de conhecimento a agentes externos.

Os perfis ficam em `codex-profiles.json`, junto às configurações do aplicativo, com gravação atômica e permissão de leitura/escrita apenas para o usuário. A API autenticada `GET /api/codex/profiles` lista os perfis e pastas encontradas; `PUT /api/codex/profiles` recebe `{ profiles: [{ id, name, home, color }], activeId }`. As preferências de visibilidade da ilha ficam em `activity-island.json`.

O Mega Brain passa `CODEX_HOME` e a identificação do perfil pelo ambiente dos processos filhos. O cadastro não lê, copia ou modifica arquivos de autenticação. Se uma pasta ainda não estiver autenticada, configure-a no Codex antes de usá-la.
