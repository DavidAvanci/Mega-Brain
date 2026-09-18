# Preferências de ambiente WSL

O desktop guarda em seu diretório de configuração por usuário somente a distro
WSL escolhida e, se o usuário a informar, um `WORKSPACE_DIR` absoluto. O arquivo
não guarda `.env`, tokens Jira, credenciais Claude ou conteúdo de `~/.claude`.

Na inicialização, o supervisor abre um shell de login na distro. Assim, o
`PATH` definido pelo usuário (inclusive `~/.local/bin`) e `HOME` continuam os
do WSL; `~/.claude` é consumido no próprio WSL pelos processos que precisarem
dele. Sem preferência de workspace, o supervisor lê `WORKSPACE_DIR` desse
ambiente e usa `$HOME/mega-brain-files/workspace` como fallback.

A tela de recuperação para `invalid-workspace` aceita apenas um caminho POSIX
absoluto. O IPC não concede shell nem acesso a arquivos à WebView: Rust repete
a validação e verifica se o diretório existe dentro da distro antes de iniciar
o backend. O caminho é passado como parâmetro posicional para o shell, nunca
como código de shell.
