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
