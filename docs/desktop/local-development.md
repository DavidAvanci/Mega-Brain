# Desenvolvimento local do Tauri

Abra o PowerShell no checkout Windows do repositório e execute:

```sh
npm run tauri:dev
```

Esse é o único comando necessário. Ele:

1. recompila `dist/server/main.mjs` e seu manifesto;
2. reutiliza um Vite compatível que já esteja em `127.0.0.1:15173`, ou inicia um;
3. adiciona `localhost` e `127.0.0.1` às exceções de proxy e remove variáveis de
   proxy vazias ou inválidas;
4. executa o shell Tauri nativo no Windows e preserva o fluxo Windows → WSL
   usado pelo backend;
5. encerra o Vite que ele próprio iniciou quando o Tauri for encerrado.

Se a porta 15173 estiver sendo usada por outro servidor, o comando falha com uma
mensagem explícita em vez de abrir uma WebView incorreta.

O modo web (`npm run dev`) continua em `5173`. A porta exclusiva `15173` evita
que o shell desktop concorra com os ambientes Vite iniciados pelos cards.

O script rejeita a execução no Linux/WSLg. Isso evita criar por engano uma janela
WebKitGTK com identidade visual do Ubuntu em vez do aplicativo Windows/WebView2.
