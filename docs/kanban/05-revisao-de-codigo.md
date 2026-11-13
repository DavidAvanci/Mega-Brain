# 05 — Auto review

Ao entrar nesta coluna, o servidor inicia automaticamente apenas o agente Revisor. O agente analisa diretamente as alterações Git dos repositórios do card e grava o relatório em `diff.json`.

O desenvolvimento concluído avança para esta etapa automaticamente. Também é possível mover um card manualmente para cá; cada nova entrada inicia uma revisão. Quando o Revisor conclui e salva o relatório, o servidor avança o card para **Code Review**. Se a revisão falhar, o card permanece em Auto Review para que o erro possa ser consultado.

Em **Code Review**, ficam a inspeção humana e ações manuais, como iniciar ambiente dev.
