export const TASK_CHECKLIST_FILE = 'TASK-CHECKLIST.json'
export const TASK_STATES = ['pending', 'done', 'failed', 'blocked', 'discarded'] as const
export type TaskState = (typeof TASK_STATES)[number]

export interface ChecklistItem {
  id: string
  title: string
  repo: string
  files: string[]
  requires: string[]
  creates: string[]
  deps: string[]
  context: string
  completionCriteria: string[]
  state: TaskState
  notes: string[]
  discardReason?: string
  timeoutMinutes?: number
  maxAttempts?: number
}

export interface TaskChecklist {
  schemaVersion: 1
  issue?: string
  items: ChecklistItem[]
}

export interface TaskCounts {
  total: number
  done: number
  failed: number
  blocked: number
  discarded: number
}

function object(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where}: esperado um objeto`)
  return value as Record<string, unknown>
}

function string(value: unknown, where: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${where}: esperado texto não vazio`)
  return value.trim()
}

function strings(value: unknown, where: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${where}: esperado um array de strings`)
  return value.map((entry, index) => string(entry, `${where}[${index}]`))
}

function fields(value: Record<string, unknown>, allowed: string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${where}.${key}: campo desconhecido`)
  }
}

/** Validates both the document shape and the dependency graph before any consumer uses it. */
export function parseTaskChecklist(input: unknown): TaskChecklist {
  let value: unknown = input
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input)
    } catch {
      throw new Error(`${TASK_CHECKLIST_FILE}: JSON inválido`)
    }
  }
  const root = object(value, TASK_CHECKLIST_FILE)
  fields(root, ['schemaVersion', 'issue', 'items'], TASK_CHECKLIST_FILE)
  if (root.schemaVersion !== 1) throw new Error(`${TASK_CHECKLIST_FILE}: schemaVersion deve ser 1`)
  if (!Array.isArray(root.items)) throw new Error(`${TASK_CHECKLIST_FILE}: items deve ser um array`)
  const items = root.items.map((entry, index): ChecklistItem => {
    const where = `items[${index}]`
    const item = object(entry, where)
    fields(
      item,
      [
        'id',
        'title',
        'repo',
        'files',
        'requires',
        'creates',
        'deps',
        'context',
        'completionCriteria',
        'state',
        'notes',
        'discardReason',
        'timeoutMinutes',
        'maxAttempts',
      ],
      where,
    )
    const id = string(item.id, `${where}.id`)
    if (!/^[A-Za-z]+\d+$/.test(id)) throw new Error(`${where}.id: use um ID como T1 ou VFY1`)
    const state = item.state === undefined ? 'pending' : item.state
    if (!TASK_STATES.includes(state as TaskState)) throw new Error(`${where}.state: estado inválido`)
    if (item.context !== undefined && typeof item.context !== 'string')
      throw new Error(`${where}.context: esperado texto`)
    const positive = (key: 'timeoutMinutes' | 'maxAttempts') => {
      const limit = item[key]
      if (limit === undefined) return undefined
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)
        throw new Error(`${where}.${key}: esperado inteiro positivo`)
      return limit
    }
    return {
      id,
      title: string(item.title, `${where}.title`),
      repo: string(item.repo, `${where}.repo`),
      files: strings(item.files, `${where}.files`),
      requires: strings(item.requires, `${where}.requires`),
      creates: strings(item.creates, `${where}.creates`),
      deps: strings(item.deps, `${where}.deps`),
      context: (item.context as string | undefined)?.trim() ?? '',
      completionCriteria: strings(item.completionCriteria, `${where}.completionCriteria`),
      state: state as TaskState,
      notes: strings(item.notes, `${where}.notes`),
      ...(item.discardReason === undefined
        ? {}
        : { discardReason: string(item.discardReason, `${where}.discardReason`) }),
      ...(item.timeoutMinutes === undefined ? {} : { timeoutMinutes: positive('timeoutMinutes') }),
      ...(item.maxAttempts === undefined ? {} : { maxAttempts: positive('maxAttempts') }),
    }
  })
  const byId = new Map<string, ChecklistItem>()
  for (const item of items) {
    if (byId.has(item.id)) throw new Error(`ID repetido: ${item.id}`)
    byId.set(item.id, item)
  }
  const active = items.filter((item) => item.state !== 'discarded')
  for (const item of active) {
    for (const dep of item.deps) {
      if (dep === item.id) throw new Error(`${item.id}: depende de si mesmo`)
      if (!byId.has(dep)) throw new Error(`${item.id}: deps ${dep} não existe na checklist`)
      if (byId.get(dep)?.state === 'discarded')
        throw new Error(`${item.id}: depende do item descartado ${dep}; atualize deps`)
    }
  }
  const visited = new Set<string>()
  const stack = new Set<string>()
  const visit = (id: string): void => {
    if (stack.has(id)) throw new Error(`Ciclo em deps: ${[...stack, id].join(' → ')}`)
    if (visited.has(id)) return
    stack.add(id)
    for (const dep of byId.get(id)?.deps ?? []) visit(dep)
    stack.delete(id)
    visited.add(id)
  }
  for (const item of active) visit(item.id)
  return { schemaVersion: 1, ...(root.issue === undefined ? {} : { issue: string(root.issue, 'issue') }), items }
}

export function activeChecklistItems(checklist: TaskChecklist): ChecklistItem[] {
  return checklist.items.filter((item) => item.state !== 'discarded')
}

export function countTasks(checklist: TaskChecklist): TaskCounts {
  const counts: TaskCounts = { total: 0, done: 0, failed: 0, blocked: 0, discarded: 0 }
  for (const item of checklist.items) {
    if (item.state === 'discarded') counts.discarded++
    else {
      counts.total++
      if (item.state !== 'pending') counts[item.state]++
    }
  }
  return counts
}

/** Appended even to customized prompts so the artifact contract remains authoritative. */
export const TASK_CHECKLIST_CONTRACT = `Contrato obrigatório da checklist: gere TASK-CHECKLIST.json (JSON válido, sem fences), nunca uma checklist Markdown.
Formato: {"schemaVersion":1,"issue":"<id do card>","items":[{"id":"T1","title":"<ação atômica>","repo":"<alias cadastrado>","files":[],"requires":[],"creates":[],"deps":[],"context":"<contexto específico do item>","completionCriteria":["<comportamento entregue>"],"state":"pending"}]}.
IDs como T1/T2 são únicos e globais entre repositórios. Use repo explícito em cada item, deps como array de IDs reais e sem ciclos. files vazio serializa o repo inteiro; requires declara pré-condições e creates arquivos novos. timeoutMinutes e maxAttempts são inteiros positivos opcionais. notes é reservado ao scheduler.
Estados: pending, done, failed, blocked e discarded. Para substituir um item, preserve-o com state=discarded e discardReason, criando novos IDs e atualizando as dependências dos consumidores.
Inclua no context e completionCriteria de cada item o necessário para implementá-lo sem depender de formatação do PLAN.md. Não crie tarefas separadas de testes ou verificação.`
