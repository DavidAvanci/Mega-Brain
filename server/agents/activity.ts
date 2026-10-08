import type { IslandVisualState } from '../../shared/domain/activity-island'
import { record } from '../agent-log'

/** Describes the operation, never the contents of private reasoning blocks. */
export function activityVisualState(activity?: string): IslandVisualState {
  const value = (activity ?? '').toLowerCase()
  if (/askuserquestion|request_user_input/.test(value)) return 'waiting'
  // A test filename being read or edited is still a read/edit operation.
  if (/^(?:[\w.]*\.)?(read|search|glob|view)(?:\b|_)/.test(value)) return 'reading'
  if (/\b(edit|editing|write|apply_patch|patch|escrevendo|editando)\b/.test(value)) return 'editing'
  if (/\b(test|tests|vitest|jest|pytest|playwright|testing|testando)\b/.test(value)) return 'testing'
  if (/\b(read|reading|search|rg|cat|glob|find|view|lendo|buscando)\b/.test(value)) return 'reading'
  if (/\b(thinking|reasoning|pensando)\b/.test(value)) return 'thinking'
  return 'working'
}

export function questionFromInput(input: unknown): string | undefined {
  const value = record(input)
  if (!value) return undefined
  const questions = Array.isArray(value.questions) ? value.questions.map(record) : [value]
  const text = questions
    .map((question) => question?.question ?? question?.text)
    .filter((question): question is string => typeof question === 'string' && Boolean(question.trim()))
    .join('\n\n')
  return text ? text.slice(0, 1200) : undefined
}

export function questionFromText(value: string | undefined): string | undefined {
  const text = value?.trim()
  return text && /\?\s*$/.test(text) ? text.slice(-1200) : undefined
}
