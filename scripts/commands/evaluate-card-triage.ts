import { readFileSync } from 'node:fs'
import { validateTriageInput } from '../../server/card-triage/service'
import { createLayaClient, parseLayaEvaluation } from '../../server/integrations/laya/client'
import { LayaFailure } from '../../server/integrations/laya/types'
import type { CardTriageResult } from '../../shared/domain/card-triage'
import { MODEL_VERSION, POLICY_VERSION } from '../../server/card-triage/policy-config'
import { decideTriage } from '../../server/card-triage/policy'
import { evaluateRows, ruleBaseline, type EvaluationRow } from '../lib/card-triage-evaluation'
import type { FlowLevel } from '../../shared/domain/cards'

const args = process.argv.slice(2)
const option = (name: string) => args[args.indexOf(name) + 1]
const path = option('--input')
const mode = option('--mode')
if (!path || !['replay', 'live'].includes(mode)) throw new Error('Use --input dataset.json --mode replay|live')
const budget = Number(option('--budget'))
if (
  mode === 'live' &&
  (!Number.isSafeInteger(budget) || budget < 1 || !process.env.LAYA_API_KEY || !process.env.LAYA_BASE_URL)
)
  throw new Error('Live exige --budget N, LAYA_API_KEY e LAYA_BASE_URL')
const data = JSON.parse(readFileSync(path, 'utf8')) as {
  examples: Array<{
    id: string
    split: string
    label: FlowLevel
    title: string
    description: string
    answers?: unknown
  }>
}
if (!Array.isArray(data.examples)) throw new Error('Dataset inválido')
const client = createLayaClient()
const rows: EvaluationRow[] = []
for (const example of data.examples) {
  if (
    !example.id ||
    !example.split ||
    !['simples', 'medio', 'dificil'].includes(example.label) ||
    typeof example.title !== 'string' ||
    typeof example.description !== 'string'
  )
    throw new Error('Exemplo inválido')
  if (mode === 'live' && rows.length >= budget) break
  const start = performance.now()
  let result: CardTriageResult
  let inputTokens = 0
  let outputTokens = 0
  try {
    const answers =
      mode === 'live'
        ? await client(
            validateTriageInput({ title: example.title, description: example.description }),
            process.env.LAYA_API_KEY!,
            process.env.LAYA_BASE_URL!,
          )
        : parseLayaEvaluation(example.answers)
    result = decideTriage(answers)
    inputTokens = answers.usage.input_tokens
    outputTokens = answers.usage.output_tokens
  } catch (error) {
    if (mode === 'replay') throw error
    const reasonCode = error instanceof LayaFailure ? error.code : 'external_error'
    result = {
      status: 'unavailable',
      reasonCode,
      retryable: reasonCode !== 'invalid_key',
      modelVersion: MODEL_VERSION,
      policyVersion: POLICY_VERSION,
    }
  }
  rows.push({
    id: example.id,
    split: example.split,
    label: example.label,
    ruleBaseline: ruleBaseline(example.title, example.description),
    result,
    latencyMs: performance.now() - start,
    inputTokens,
    outputTokens,
  })
}
console.log(
  JSON.stringify(
    {
      mode,
      bySplit: Object.fromEntries(
        [...new Set(rows.map((row) => row.split))].map((split) => [
          split,
          evaluateRows(rows.filter((row) => row.split === split)),
        ]),
      ),
    },
    null,
    2,
  ),
)
