import type { ChecklistItem } from '../shared/domain/task-checklist'

export function checklistItem(id: string, overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id,
    title: `Implementar ${id}`,
    repo: 'repo',
    state: 'pending',
    files: [],
    requires: [],
    creates: [],
    deps: [],
    context: '',
    completionCriteria: [],
    notes: [],
    ...overrides,
  }
}

export function checklistJson(items: Partial<ChecklistItem>[] = []): string {
  return JSON.stringify({ schemaVersion: 1, items: items.map((item, index) => checklistItem(`T${index + 1}`, item)) })
}
