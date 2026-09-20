import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { FlowLevel } from '../../shared/domain/cards'
import { DEFAULT_FLOW } from './card-folder'

export interface StageProgress {
  done: number
  total: number
  phase: string
}

const ARTIFACT_PHASES = [
  ['PLAN.md', 'Criando plano'],
  ['TASK-CHECKLIST.md', 'Criando tasks'],
  ['TEST-CHECKLIST.md', 'Criando testes'],
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
    if (existsSync(artifact) && statSync(artifact).mtimeMs >= since) done++
    else if (phase === 'Finalizando') phase = label
  }
  return { done, total: artifacts.length, phase }
}

const CHECKBOX = /^\s*[-*]\s*\[([ xX!-])\]\s*(.*)/

export function checklistProgress(file: string): (path: string) => StageProgress {
  return (path) => {
    const full = join(path, file)
    if (!existsSync(full)) return { done: 0, total: 1, phase: `Aguardando ${file}` }
    const boxes = readFileSync(full, 'utf8')
      .split('\n')
      .map((line) => CHECKBOX.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
    const done = boxes.filter((match) => match[1] === 'x' || match[1] === 'X').length
    const pending = boxes.find((match) => match[1] === ' ')
    return {
      done,
      total: boxes.length || 1,
      phase: pending
        ? pending[2]
            .replace(/\{[^}]*\}\s*$/, '')
            .trim()
            .slice(0, 60)
        : 'Finalizando',
    }
  }
}
