# Integrações de plataforma a partir do backend WSL

O backend nunca monta uma linha de shell com caminhos, URLs ou dados do card.
Cursor, Windows Terminal, Chrome e PowerShell são executados com `spawn(command,
args)`: portanto caminhos em `/home` ou `/mnt/c` com espaços e Unicode continuam
um único argumento.

`cursor`, `wt.exe`, Chrome e PowerShell são opcionais conforme a funcionalidade.
Antes de abrir uma integração, o backend procura o executável configurado ou
candidatos conhecidos no `PATH`/WSL. Se não existir, a rota retorna um erro
acionável (instalar ou configurar o executável), em vez de confirmar uma abertura
que só falhará assincronamente. No WSL, Chrome e PowerShell usam também os caminhos
diretos usuais em `/mnt/c/Program Files/...` e `/mnt/c/Windows/...`.

O Café mantém uma única sessão. O script PowerShell restaura
`SetThreadExecutionState(ES_CONTINUOUS)` ao terminar; a API também descarta a
sessão antes de enviar o sinal de parada e a descarta se o spawn falhar. Assim uma
falha não deixa o botão preso como ativo.

Ambientes dev continuam usando processos destacados próprios, registrados no
`ProcessOwner` do backend desktop. O encerramento do backend termina somente esses
filhos registrados; Cursor, Terminal e Chrome permanecem sessões externas. A rota
de parada usa o estado do card para terminar as árvores do ambiente, e as URLs de
frontend retornadas são `http://localhost:<porta>`.

## Validação ainda manual

É necessário validar em Windows 11 + WSL2 real: descoberta de `wt.exe`/Cursor pelo
PATH Windows, abertura de Chrome com múltiplas URLs, bloqueio/desbloqueio do Café,
retomada de Claude no Terminal e criação/parada completa de ambientes dev. Os testes
Node cobrem apenas construção de argv, descoberta sem shell e cleanup falso; eles
nunca iniciam Claude, PowerShell, Windows Terminal, Cursor, Chrome ou Docker.
