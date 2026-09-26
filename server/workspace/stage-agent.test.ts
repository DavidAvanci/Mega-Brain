import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { stageAgentCommand } from './stage-agent'
import { STAGES } from './stage-catalog'

const card = { title: 'Refatorar serviço', description: '', status: 'planejando', flow: 'dificil' as const }

test('builds a Codex command with the configured executable and model settings', () => {
  const planning = STAGES.find((stage) => stage.name === 'task-planning')!
  const [bin, args] = stageAgentCommand(
    '/tmp/card',
    planning,
    card,
    'gpt-5',
    'high',
    'chatgpt',
    undefined,
    '/opt/codex',
  )

  expect(bin).toBe('/opt/codex')
  expect(args).toContain('--model')
  expect(args).toContain('gpt-5')
  expect(args).toContain('model_reasoning_effort="high"')
  expect(args.at(-1)).toContain('/task-planning Refatorar serviço')
})

test('planning prompt resolves repository mentions from the active catalog', () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-stage-mention-'))
  const checkout = join(root, 'api')
  mkdirSync(join(checkout, '.git'), { recursive: true })
  writeFileSync(
    join(root, 'repositories.json'),
    JSON.stringify({
      version: 1,
      repositories: [{ id: 'repo_1', alias: 'api', displayName: 'API', path: checkout, active: true }],
    }),
  )
  const planning = STAGES.find((stage) => stage.name === 'task-planning')!
  const [, args] = stageAgentCommand(
    '/tmp/card',
    planning,
    { ...card, description: 'Trabalhe em @api' },
    'default',
    'high',
    'chatgpt',
    undefined,
    undefined,
    join(root, 'settings.json'),
  )
  expect(args.at(-1)).toContain('"id":"repo_1"')
  expect(args.at(-1)).toContain(JSON.stringify({ id: 'repo_1', alias: 'api', path: checkout }))
})
