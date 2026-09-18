# Spike de supervisão Windows → WSL

Data: 2026-09-01  
Ambiente que executou o teste: sessão Linux já hospedada em WSL2, no
repositório `/home/david/mega-brain`.

## Objetivo

Validar que um processo **nativo do Windows** consegue iniciar um comando
descartável no WSL, capturar `stdout` e `stderr`, observar seu término e
solicitar seu encerramento limpo. Esse será o caminho do supervisor Tauri em
produção.

## Tentativa segura realizada

Nenhum processo do Mega Brain, servidor Vite, configuração do WSL ou pacote foi
alterado. Os comandos foram iniciados a partir da sessão WSL somente para
verificar se é possível acionar os binários nativos do Windows neste ambiente:

```text
cmd.exe /d /c "wsl.exe -l -q"
powershell.exe -NoProfile -NonInteractive -Command "$PSVersionTable.PSVersion.ToString(); wsl.exe --status"
```

Em ambas as tentativas, `wsl.exe` terminou antes de executar o comando pedido,
com:

```text
<3>WSL (2 - ) ERROR: UtilBindVsockAnyPort:309: socket failed 1
```

## Resultado

**Validado em PowerShell Windows nativo.** Em 2026-09-01, o procedimento
pendente foi executado com `wsl.exe -d Ubuntu`. O processo descartável no WSL
publicou o PID `187887`, escreveu `STDOUT_OK` e `STDERR_OK` nos streams
corretos, recebeu `SIGTERM`, registrou `TERM_OK` em stdout e terminou. O
processo Windows confirmou `HasExited=True` e a ausência posterior do arquivo
de PID (`PID_REMOVED`).

Isso comprova que o supervisor Windows pode iniciar o backend no WSL, capturar
os dois streams, observar a finalização e solicitar um encerramento limpo. A
falha anterior de WSL aninhado permanece apenas como limitação do ambiente de
desenvolvimento Linux; não afeta a topologia do Tauri executado nativamente no
Windows.

## Investigação anterior nesta sessão

Foi verificado se o ambiente disponibiliza uma via externa para iniciar um
processo realmente nativo do Windows, sem o encadeamento WSL → `cmd.exe`/
PowerShell → `wsl.exe` que já falhou. Não há tal via: o executor desta tarefa é
um processo Linux em WSL, os binários `cmd.exe`, `powershell.exe` e `wsl.exe`
estão acessíveis apenas pela interop a partir dessa mesma sessão, e não foi
exposta uma ferramenta de automação de desktop, WinRM/SSH já conectado, agente
Windows ou terminal Windows independente. A unidade `C:` também está montada
somente para leitura nesta sessão.

Elevação não foi solicitada: ela não transformaria o executor Linux em um
processo Windows externo e não produziria a evidência exigida. Assim, não foi
seguro iniciar outro teste aninhado nem há uma via legítima disponível aqui para
capturar os dois streams, observar o encerramento e enviar o sinal de término.
O bloqueio foi resolvido posteriormente pela execução do procedimento em um
PowerShell Windows nativo, cuja evidência está registrada acima.

## Procedimento executado no Windows nativo

O teste deverá lançar `wsl.exe -d <distro> -- sh -lc <comando>` com pipes de
`stdout` e `stderr` separados; o comando deverá publicar seu PID, escrever uma
linha em cada stream, aguardar `SIGTERM` e registrar o recebimento do sinal.
O processo Windows deverá então:

1. confirmar ambas as linhas capturadas;
2. solicitar `SIGTERM` ao PID WSL por uma segunda invocação `wsl.exe`;
3. aguardar o exit status do primeiro processo;
4. confirmar o registro do trap de término e ausência do PID.

As quatro evidências foram obtidas: linhas nos dois streams, envio de
`SIGTERM`, encerramento do processo Windows e remoção do PID.
