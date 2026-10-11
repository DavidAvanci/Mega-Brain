# Checklist de implementação em JSON

`TASK-CHECKLIST.json` é a fonte única das tarefas do card. `PLAN.md` continua reservado ao contexto e às decisões gerais. O modelo e a validação compartilhados estão em `shared/domain/task-checklist.ts`; a persistência em `shared/storage/task-checklist.ts`.

```json
{
  "schemaVersion": 1,
  "issue": "MB-001",
  "items": [
    {
      "id": "T1",
      "title": "Expor o atributo total",
      "repo": "api",
      "files": ["src/orders/serializer.ts"],
      "requires": [],
      "creates": [],
      "deps": [],
      "context": "total é um inteiro no contrato público.",
      "completionCriteria": ["O serializer inclui total no resultado."],
      "state": "pending",
      "notes": []
    }
  ]
}
```

`schemaVersion` e `items` são obrigatórios. Cada item exige `id`, `title` e `repo`; IDs seguem o formato de letras seguidas de dígitos, como `T1` e `VFY1`. Arrays omitidos são normalizados para `[]`, contexto omitido para texto vazio e estado omitido para `pending`. `issue`, `discardReason`, `timeoutMinutes` e `maxAttempts` são opcionais. Limites devem ser inteiros positivos. Campos desconhecidos são rejeitados para evitar que erros de digitação removam restrições de execução.

Estados: `pending`, `done`, `failed`, `blocked` e `discarded`. Itens descartados continuam no histórico e na interface, mas não são executados nem entram no total de progresso. Um consumidor ativo não pode depender de um item descartado: suas dependências devem apontar para os itens substitutos. Bloqueio e descarte possuem contagens distintas.

O scheduler continua respeitando dependências entre repositórios e sobreposição de arquivos dentro do mesmo repo. `files: []` reserva o repositório inteiro. `requires` contém pré-condições e `creates` contém arquivos produzidos. O prompt individual é montado com contexto e critérios do JSON; contexto por ID no `PLAN.md` é mantido como complemento para cards migrados.

O scheduler grava estados e notas por ID, preservando os outros campos. Correções geradas pela verificação são adicionadas com IDs `VFY` livres, considerando também o histórico descartado. Gravações são validadas antes de substituir atomicamente o arquivo, e o scheduler serializa suas atualizações. Edição externa simultânea durante execução não possui resolução automática de conflitos.

`GET /api/workspace/detail?name=<card>&section=checklist` retorna `{ "checklist": <documento ou null> }`. O detalhe completo também inclui `checklist`. O acesso por `section=file&file=TASK-CHECKLIST.json` permanece disponível para leitura do artefato. A aba Tasks usa componentes próprios; o plano continua com a visualização Markdown.

Cards antigos são convertidos no primeiro acesso pela camada de persistência. A conversão preserva IDs explícitos, estados, metadados, contexto indentado, notas e itens riscados; IDs ausentes são atribuídos sem colidir com os existentes. O original é preservado em `TASK-CHECKLIST.md.bak`. Havendo JSON, ele sempre prevalece. Um JSON inválido nunca usa o Markdown como fallback, e uma migração inválida preserva o original e informa o erro. Snapshots de etapas preservam o artefato JSON para interrupção e retomada. Snapshots anteriores à migração também restauram o conteúdo da checklist no formato atual, inclusive quando o artefato ainda não existia.
