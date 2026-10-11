import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { checklistJson } from '../../test/checklist-fixtures'
import { readAgent } from './stage-agent-status'

test.each(['claude', 'codex'])(
  'successful %s planning cannot release a missing, empty or invalid checklist',
  (provider) => {
    const path = mkdtempSync(join(tmpdir(), 'planning-validation-'))
    writeFileSync(join(path, 'card.json'), JSON.stringify({ title: 'Card', status: 'planejando' }))
    writeFileSync(join(path, 'agent.json'), JSON.stringify({ stage: 'task-planning', provider, pid: null }))
    writeFileSync(
      join(path, 'task-planning.jsonl'),
      JSON.stringify(provider === 'claude' ? { type: 'result', subtype: 'success' } : { type: 'turn.completed' }),
    )
    expect(readAgent(path, () => false)).toMatchObject({
      status: 'erro',
      error: expect.stringContaining('nenhum item executável'),
    })
    writeFileSync(join(path, 'TASK-CHECKLIST.json'), '{')
    expect(readAgent(path, () => false)).toMatchObject({
      status: 'erro',
      error: expect.stringContaining('JSON inválido'),
    })
    writeFileSync(join(path, 'TASK-CHECKLIST.json'), checklistJson([{ state: 'discarded' }]))
    expect(readAgent(path, () => false)?.status).toBe('erro')
    writeFileSync(join(path, 'TASK-CHECKLIST.json'), checklistJson([{ title: 'Implementar comportamento' }]))
    expect(readAgent(path, () => false)?.status).toBe('concluido')
  },
)
