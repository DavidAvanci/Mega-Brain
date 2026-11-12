# 05 — Auto review

Ao entrar nesta coluna, o servidor inicia automaticamente o fluxo Smart Diff existente, usando o prompt e as configurações do agente Revisor. O resultado fica salvo em `diff.json` e pode ser consultado na aba Diff do card.

O desenvolvimento concluído avança para esta etapa automaticamente. Também é possível mover um card manualmente para cá; cada nova entrada inicia uma revisão. Quando o Revisor conclui e salva o relatório, o servidor avança o card para **Code Review**. Se a revisão falhar, o card permanece em Auto review para que o erro possa ser consultado.

Em **Code Review**, ficam a inspeção humana e as ações manuais, como iniciar ambiente dev ou executar novamente o Revisor.
