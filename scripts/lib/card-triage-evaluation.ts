import type { FlowLevel } from '../../shared/domain/cards'
import type { CardTriageResult } from '../../shared/domain/card-triage'

export interface EvaluationRow {
  id: string
  split: string
  label: FlowLevel
  ruleBaseline: FlowLevel
  result: CardTriageResult
  latencyMs: number
  inputTokens: number
  outputTokens: number
}
export function wilson(successes: number, count: number): [number, number] | null {
  if (!count) return null
  const z = 1.96,
    p = successes / count,
    d = 1 + (z * z) / count
  const center = (p + (z * z) / (2 * count)) / d
  const margin = (z * Math.sqrt((p * (1 - p)) / count + (z * z) / (4 * count * count))) / d
  return [Math.max(0, center - margin), Math.min(1, center + margin)]
}
export function evaluateRows(rows: EvaluationRow[]) {
  const suggested = rows.filter((row) => row.result.status === 'suggested')
  const correct = suggested.filter(
    (row) => row.result.status === 'suggested' && row.result.suggestedFlow === row.label,
  ).length
  const difficult = rows.filter((row) => row.label === 'dificil')
  const ruleCorrect = rows.filter((row) => row.ruleBaseline === row.label).length
  const confusion: Record<string, Record<string, number>> = {}
  const statuses: Record<string, number> = {}
  for (const row of rows) {
    statuses[row.result.status] = (statuses[row.result.status] ?? 0) + 1
    const prediction = row.result.status === 'suggested' ? row.result.suggestedFlow : row.result.status
    confusion[row.label] ??= {}
    confusion[row.label][prediction] = (confusion[row.label][prediction] ?? 0) + 1
  }
  const percentile = (values: number[], q: number) =>
    values.length ? values.sort((a, b) => a - b)[Math.ceil(q * values.length) - 1] : null
  const difficultAs = (flow: FlowLevel) =>
    difficult.filter((row) => row.result.status === 'suggested' && row.result.suggestedFlow === flow).length
  return {
    total: rows.length,
    suggestions: suggested.length,
    correct,
    precision: suggested.length ? correct / suggested.length : null,
    precisionInterval: wilson(correct, suggested.length),
    coverage: rows.length ? suggested.length / rows.length : null,
    coverageInterval: wilson(suggested.length, rows.length),
    difficultTotal: difficult.length,
    difficultAsSimple: difficultAs('simples'),
    difficultAsMedium: difficultAs('medio'),
    difficultAsSimpleInterval: wilson(difficultAs('simples'), difficult.length),
    defaultDifficultAccuracy: rows.length ? difficult.length / rows.length : null,
    ruleBaselineAccuracy: rows.length ? ruleCorrect / rows.length : null,
    confusion,
    statuses,
    latencyP50Ms: percentile(
      rows.map((row) => row.latencyMs),
      0.5,
    ),
    latencyP95Ms: percentile(
      rows.map((row) => row.latencyMs),
      0.95,
    ),
    inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
  }
}

/** Deliberately simple baseline for comparison, never used for product suggestions. */
export function ruleBaseline(title: string, description: string): FlowLevel {
  const text = `${title} ${description}`.toLowerCase()
  if (/auth|seguran|security|migra|migration|contrato|contract|permiss|payment|pagamento/.test(text)) return 'dificil'
  if (/texto|label|copy|ícone|icone|css|cor |color |typo|ortografi/.test(text)) return 'simples'
  return 'medio'
}
