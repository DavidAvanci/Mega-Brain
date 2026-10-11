import { readFileSync } from 'node:fs'
import {
  activeChecklistItems,
  parseTaskChecklist,
  type ChecklistItem,
  type TaskState,
} from '../../shared/domain/task-checklist.ts'
import { readTaskChecklist, writeTaskChecklist } from '../../shared/storage/task-checklist.ts'

export type Item = ChecklistItem
export type ItemState = Exclude<TaskState, 'discarded'>

export function parseChecklist(json: string): Item[] {
  return activeChecklistItems(parseTaskChecklist(json))
}

/** Build PR text only from implementation items that the scheduler marked done. */
export function completedTaskSummary(json: string, repo?: string): string {
  const items = parseChecklist(json).filter((item) => item.state === 'done' && (!repo || item.repo === repo))
  const grouped = new Map<string, string[]>()
  for (const item of items) {
    const tasks = grouped.get(item.repo) ?? []
    tasks.push(item.title)
    grouped.set(item.repo, tasks)
  }
  return [...grouped]
    .map(([name, tasks]) => `${grouped.size > 1 ? `### ${name}\n` : ''}${tasks.map((task) => `- ${task}`).join('\n')}`)
    .join('\n\n')
}

export function readChecklist(wsPath: string): string {
  return JSON.stringify(readTaskChecklist(wsPath) ?? { schemaVersion: 1, items: [] })
}

export interface ChecklistRepair {
  repo: string
  check: string
  summary: string
  task: string
  files?: string[]
}

export function appendChecklistRepairs(file: string, failures: ChecklistRepair[]): number {
  const checklist = parseTaskChecklist(readFileSync(file, 'utf8'))
  const existing = new Set(checklist.items.map((item) => item.id))
  let next = 1
  const clean = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 500)
  for (const failure of failures) {
    while (existing.has(`VFY${next}`)) next++
    const id = `VFY${next++}`
    existing.add(id)
    const title = clean(failure.task)
    if (!title) throw new Error('A task de correção veio vazia')
    checklist.items.push({
      id,
      title: `${title} (corrigir ${clean(failure.check)}: ${clean(failure.summary)})`,
      repo: failure.repo,
      files: failure.files ?? [],
      requires: [],
      creates: [],
      deps: [],
      context: failure.summary,
      completionCriteria: [],
      state: 'pending',
      notes: [],
    })
  }
  if (failures.length) writeTaskChecklist(file, checklist)
  return failures.length
}

export function matchesPattern(path: string, pattern: string): boolean {
  if (path === pattern || path.startsWith(`${pattern.replace(/\/?\*?$/, '')}/`)) return true
  const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
  return regex.test(path)
}

export function createdByDeps(item: Item, items: Item[]): string[] {
  const byId = new Map(items.map((other) => [other.id, other]))
  const visited = new Set<string>()
  const pending = [...item.deps]
  const created: string[] = []
  while (pending.length) {
    const dep = byId.get(pending.pop()!)
    if (!dep || visited.has(dep.id)) continue
    visited.add(dep.id)
    if (dep.repo === item.repo) created.push(...dep.creates)
    pending.push(...dep.deps)
  }
  return created
}

export function pendingRequires(item: Item, items: Item[], exists: (pattern: string) => boolean): string[] {
  const created = createdByDeps(item, items)
  return item.requires.filter((pattern) => !exists(pattern) && !created.some((path) => matchesPattern(path, pattern)))
}

export function overlaps(a: Item, b: Item): boolean {
  if (a.repo !== b.repo) return false
  if (!a.files.length || !b.files.length) return true
  return a.files.some((fa) => b.files.some((fb) => matchesPattern(fa, fb) || matchesPattern(fb, fa)))
}

export function ready(items: Item[], runningIds: Set<string>): Item[] {
  const done = new Set(items.filter((item) => item.state === 'done').map((item) => item.id))
  const running = items.filter((item) => runningIds.has(item.id))
  return items.filter(
    (item) =>
      item.state === 'pending' &&
      !runningIds.has(item.id) &&
      item.deps.every((dep) => done.has(dep)) &&
      !running.some((other) => overlaps(other, item)),
  )
}

export function blockedByDeps(items: Item[]): Map<string, string> {
  const states = new Map(items.map((item) => [item.id, item.state]))
  const blocked = new Map<string, string>()
  let grew = true
  while (grew) {
    grew = false
    for (const item of items) {
      if (item.state !== 'pending' || blocked.has(item.id)) continue
      const culprit = item.deps.find(
        (dep) => blocked.has(dep) || states.get(dep) === 'failed' || states.get(dep) === 'blocked',
      )
      if (culprit) {
        blocked.set(item.id, culprit)
        grew = true
      }
    }
  }
  return blocked
}

export function markItem(file: string, item: Item, state: ItemState, note?: string): void {
  const checklist = parseTaskChecklist(readFileSync(file, 'utf8'))
  const target = checklist.items.find((entry) => entry.id === item.id)
  if (!target) throw new Error(`Item ${item.id} não encontrado em ${file}`)
  if (target.state === 'discarded') throw new Error(`Item ${item.id} foi descartado`)
  target.state = state
  if (note?.trim()) target.notes.push(note.trim())
  writeTaskChecklist(file, checklist)
}

export function resetUnfinished(file: string): void {
  const checklist = parseTaskChecklist(readFileSync(file, 'utf8'))
  for (const item of checklist.items) {
    if (item.state === 'failed' || item.state === 'blocked') {
      item.state = 'pending'
      item.notes = []
    }
  }
  writeTaskChecklist(file, checklist)
}

export function widenFiles(file: string, item: Item, touched: string[]): string[] {
  const checklist = parseTaskChecklist(readFileSync(file, 'utf8'))
  const target = checklist.items.find((entry) => entry.id === item.id)
  if (!target || !target.files.length || target.state === 'discarded') return []
  const added = [...new Set(touched)].filter((path) => !target.files.some((pattern) => matchesPattern(path, pattern)))
  if (!added.length) return []
  target.files.push(...added)
  writeTaskChecklist(file, checklist)
  return added
}
