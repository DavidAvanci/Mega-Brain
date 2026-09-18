import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { itemContext, planSection, readPlan } from './plan'

const PLAN = `---
issue: TAT1C0-85
type: bug
---
# Plano

## O que acontecia
Parcelas encolhiam a cada pagamento.

## O que foi feito
Congela o restante ao ligar o switch.

## Plano por repositório

### api-core

#### T1 Criar migration
Adicionar coluna split_frozen.

#### T2 Serializer
Expor frozenRemaining.
`

test('readPlan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plan-'))
  writeFileSync(join(dir, 'PLAN.md'), PLAN)
  const plan = readPlan(dir)
  expect(plan.issue).toBe('TAT1C0-85')
  expect(plan.type).toBe('fix')
  expect(readPlan(mkdtempSync(join(tmpdir(), 'plan-')))).toMatchObject({ issue: undefined, type: 'feature' })
})

test('planSection and itemContext', () => {
  expect(planSection(PLAN, /o que foi feito/i)).toBe('Congela o restante ao ligar o switch.')
  expect(itemContext(PLAN, 'T1')).toBe('Adicionar coluna split_frozen.')
  expect(itemContext(PLAN, 'T9')).toBe('')
})
