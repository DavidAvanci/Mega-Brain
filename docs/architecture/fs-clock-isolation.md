# Isolamento seletivo de filesystem e relógio

## Escopo adotado

Foram introduzidas interfaces mínimas em `server/system.ts` apenas nos pontos
em que o ambiente externo impede testes determinísticos:

- `Clock` para os caches de status do Jira e de uso do Claude;
- `TextFileReader` para a leitura da credencial OAuth do Claude.

Os testes usam relógio e leitor em memória; portanto não consultam o horário
real, `~/.claude` nem qualquer credencial do usuário.

## O que permanece nativo deliberadamente

O serviço de workspace continua usando `node:fs` diretamente. Ele depende de
`realpath`, `stat` e symlinks para aplicar a fronteira de segurança do
workspace, e suas escritas/remoções fazem parte do comportamento de domínio.
Uma fachada genérica de filesystem exigiria reproduzir essas semânticas e
reduziria a confiança no guard já testado. Os testes desse serviço usam roots
temporários, nunca o workspace configurado. A extração de um adaptador menor
só será feita se o próximo conjunto de testes de contrato mostrar uma lacuna
concreta.
