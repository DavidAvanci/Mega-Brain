import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { FlowLevel } from '../../shared/domain/cards'
import { DEFAULT_FLOW } from './card-folder'
import { activeChecklistItems, countTasks, TASK_CHECKLIST_FILE } from '../../shared/domain/task-checklist'
import { readTaskChecklist } from '../../shared/storage/task-checklist'

export interface StageProgress {
  done: number
  total: number
  phase: string
}

const ARTIFACT_PHASES = [
  ['PLAN.md', 'Iniciando plano'],
  [TASK_CHECKLIST_FILE, 'Criando tasks'],
] as const

export const CARD_FILES = ARTIFACT_PHASES.map(([file]) => file)

export function planningProgress(path: string, startedAt?: string, flow: FlowLevel = DEFAULT_FLOW): StageProgress {
  const since = startedAt ? Date.parse(startedAt) : 0
  const artifacts =
    flow === 'simples' ? ARTIFACT_PHASES.slice(1, 2) : flow === 'medio' ? ARTIFACT_PHASES.slice(0, 2) : ARTIFACT_PHASES
  let done = 0
  let phase = 'Finalizando'
  for (const [file, label] of artifacts) {
    const artifact = join(path, file)
    let valid = existsSync(artifact) && statSync(artifact).mtimeMs >= since
    if (valid && file === TASK_CHECKLIST_FILE) {
      try {
        valid = Boolean(readTaskChecklist(path)?.items.some((item) => item.state !== 'discarded'))
      } catch { valid = false }
    }
    if (valid) done++
    else if (phase === 'Finalizando') phase = label
  }
  return { done, total: artifacts.length, phase }
}

export function checklistProgress(): (path: string) => StageProgress {
  return (path) => {
    try {
      const checklist = readTaskChecklist(path)
      if (!checklist) return { done: 0, total: 1, phase: `Aguardando ${TASK_CHECKLIST_FILE}` }
      const counts = countTasks(checklist)
      const pending = activeChecklistItems(checklist).find((item) => item.state === 'pending')
      return { done: counts.done, total: counts.total || 1, phase: pending?.title.slice(0, 60) ?? (counts.failed || counts.blocked ? 'Itens com falha ou bloqueio' : 'Finalizando') }
    } catch (error) {
      return { done: 0, total: 1, phase: `Checklist inválida: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
}
