import type { ChecklistItem } from '../../shared/domain/task-checklist.ts'
import { itemContext } from './plan.ts'

export function taskItemPrompt(
  item: ChecklistItem,
  instructions: string,
  repositories: { repo: string; path: string }[],
  planRaw = '',
  projectRuntime?: { version: string; execPath: string; warning?: string },
  repairCheck?: { id: string; argv: string[]; scope?: 'card-files' | 'project'; diagnostics: { file: string; rule: string; message: string }[] },
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
    projectRuntime
      ? `Comandos do projeto devem usar Node ${projectRuntime.version} (${projectRuntime.execPath}); o PATH desta execução já seleciona este runtime. A CLI do agente mantém runtime independente.${projectRuntime.warning ? ` Aviso: ${projectRuntime.warning}` : ''}`
      : '',
    repairCheck
      ? [
          `Correção de verificação autorizada: check ${repairCheck.id}.${repairCheck.diagnostics.length ? ' Diagnósticos confirmados:' : ''}`,
          ...repairCheck.diagnostics.map((diagnostic) => `- ${diagnostic.file} · ${diagnostic.rule}: ${diagnostic.message}`),
          repairCheck.scope === 'project'
            ? `Comando de confirmação integral autorizado: ${JSON.stringify(repairCheck.argv)} sem argumentos de arquivo. Não execute checks ou builds diferentes.`
            : `Comando de leitura autorizado para confirmação: ${JSON.stringify(repairCheck.argv)} seguido somente pelos arquivos desta task. Não execute checks ou builds diferentes.`,
        ].join('\n')
      : '',
    repairCheck
      ? 'Esta task é uma correção de verificação. A confirmação do scheduler executará o check autorizado depois da sua implementação.'
      : 'Esta task é de implementação normal. Não execute lint, typecheck, build, testes ou outros checks do projeto.',
    `Implemente este item somente na worktree atual de ${item.repo}. Consulte os demais repositórios para entender contratos; mudanças neles devem ser feitas por seus próprios itens do checklist. Dependências entre itens coordenam a execução entre repositórios.`,
    'Não edite TASK-CHECKLIST.json nem PLAN.md; o scheduler persiste o resultado do item.',
    legacyContext ? `Contexto do plano:\n${legacyContext}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}
