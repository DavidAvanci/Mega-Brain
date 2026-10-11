import type { ChecklistItem } from '../../shared/domain/task-checklist.ts'
import { itemContext } from './plan.ts'

export function taskItemPrompt(
  item: ChecklistItem,
  instructions: string,
  repositories: { repo: string; path: string }[],
  planRaw = '',
): string {
  const legacyContext = itemContext(planRaw, item.id)
  return [
    instructions,
    `Item: ${item.id} — ${item.title}`,
    item.context ? `Contexto do item:\n${item.context}` : '',
    item.completionCriteria.length
      ? `Critérios de conclusão:\n${item.completionCriteria.map((criterion) => `- ${criterion}`).join('\n')}`
      : '',
    item.files.length ? `Arquivos permitidos: ${item.files.join(', ')}` : 'Arquivos permitidos: (não especificado)',
    `Workspace da tarefa (vários repositórios): ${repositories.map(({ repo, path }) => `${repo}: ${path}`).join('; ')}`,
    `Implemente este item somente na worktree atual de ${item.repo}. Consulte os demais repositórios para entender contratos; mudanças neles devem ser feitas por seus próprios itens do checklist. Dependências entre itens coordenam a execução entre repositórios.`,
    'Não edite TASK-CHECKLIST.json nem PLAN.md; o scheduler persiste o resultado do item.',
    legacyContext ? `Contexto do plano:\n${legacyContext}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}
