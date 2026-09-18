# Guardrails de segurança da suíte

`vitest.config.ts` carrega `test/safety-guard.ts` antes dos módulos de teste.
Ele instala proteções que falham fechado para três classes de efeitos externos:

- Claude e shells/comandos de rede (`claude*`, `sh`, `bash`, PowerShell,
  `curl` e similares) não podem ser iniciados;
- Git só pode ser executado com `cwd` (ou `git -C`) dentro do diretório
  temporário do sistema. Isso mantém válidos os fixtures Git já existentes;
- qualquer `fetch` global para `*.atlassian.net` falha antes da conexão.

Além disso, os serviços `workspace` e `chat` consultam um hook instalado só
durante Vitest. A criação de serviço com um workspace fora de `tmpdir()` falha
antes de criar, escrever ou remover arquivos. O hook não é instalado pelo
runtime web nem pelo backend de produção.

As verificações são exercitadas em `test/safety-guard.test.ts`. Testes de
integração que precisem de Jira devem injetar uma função `request` falsa em
`createJiraService`; os testes não devem usar a credencial/configuração local.

Limites: estas proteções cobrem a API Node normalmente usada pelo projeto
(`child_process` e `globalThis.fetch`) e os serviços extraídos. Elas não são um
sandbox do sistema operacional: código de teste que invoque binários via uma
extensão nativa, outro runtime ou uma conexão de baixo nível deliberadamente
fora dessas fronteiras exige revisão específica.
